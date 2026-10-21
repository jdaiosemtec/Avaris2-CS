# Builds the Insight Flag theme files (Avaris2 Layer Theme Editor -> Load... -> Add).
# Every flag returns a level: 0 normal, 1 warning, 2 high, 3 critical. Flags using dur / run / win get duration
# statistics in the Report (Insights page). "worst over run" variants use peak() and show outside play mode.
import json, sys, os
out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
U = {
 'SI': dict(L='m', V='m/s', tol=0.003, rim05=0.15, fb1=0.30, fb2=0.61, vlow=0.61, vhigh=3.05, tw=0.30, eps=0.0001),
 'US': dict(L='ft', V='ft/s', tol=0.01, rim05=0.5, fb1=1.0, fb2=2.0, vlow=2.0, vhigh=10.0, tw=1.0, eps=0.001),
}
LEVELS = [('0', 'Normal', '#cfd8dc'), ('1', 'Warning', '#fbc02d'), ('2', 'High', '#fb8c00'), ('3', 'Critical', '#e53935')]
def ranges(layer, levels):
    sz = {'node': [3, 6, 8, 10], 'link': [1, 2.5, 3.5, 5], 'sub': [1, 1, 1, 1]}[layer]
    return [{'v': v, 'label': lab, 'color': c, 'size': sz[i], 'show': True} for i, (v, lab, c) in enumerate(LEVELS) if int(v) in levels]
def item(layer, name, expr, where, levels, desc, enabled=False):
    return {'name': name, 'field': 'x:' + expr, 'kind': 'individual', 'abs': False, 'nulls': False, 'enabled': enabled, 'legend': True,
            'useColor': True, 'useSize': layer != 'sub', 'method': 'linear', 'ramp': 'Blue-Red', 'invert': False, 'n': len(levels), 'auto': False,
            'where': where, 'ranges': ranges(layer, levels), 'nullRow': {'color': '#b0bec5', 'size': 2, 'show': True}, 'desc': desc, 'insight': True}
def flags(u):
    F = f"(rptFlooding > 0 or rptHgl >= rimElev - {u['tol']})"
    S = "rptHgl > crownElev"
    Lv = f"(sysRain = 0 and abs(rptFlow) > {u['eps']} and abs(rptVel) < {u['vlow']})"
    Rv = f"rptFlow < -{u['eps']}"
    Dw = "(sysRain = 0 and rptCapacity > 0.5)"
    Rc = f"(rptRainfall = 0 and rptRunoff > {u['eps']})"
    node = [
     ('Node flooding (HGL at / above rim)', f"iif({F}, iif(dur({F}) > 15 or rptHgl - rimElev > {u['rim05']}, 3, 2), 0)", "type <> 'OUTFALL'", [0, 2, 3],
      f"Flooding now = High; Critical when flooded > 15 min in total or HGL > {u['rim05']} {u['L']} above rim.", True),
     ('Surcharge duration (HGL above pipe crown)', f"iif(dur({S}) > 60, 2, iif(dur({S}) > 10, 1, 0))", "type <> 'OUTFALL'", [0, 1, 2],
      'Cumulative time above the crown of the highest connected conduit: > 10 min Warning, > 60 min High.', False),
     ('Freeboard compression (rim - HGL)', f"iif({F}, 0, iif(rimElev - rptHgl < {u['fb1']}, 2, iif(rimElev - rptHgl < {u['fb2']}, 1, 0)))", "type = 'JUNCTION'", [0, 1, 2],
      f"Not flooding but rim - HGL < {u['fb2']} {u['L']} Warning, < {u['fb1']} {u['L']} High.", False),
     ('Storage nearing capacity', "iif(rptFlooding > 0, 3, iif(rptVolume / maxVolume > 0.95, 2, iif(rptVolume / maxVolume > 0.8, 1, 0)))", "type = 'STORAGE'", [0, 1, 2, 3],
      'Volume / full volume > 80 % Warning, > 95 % High, overflowing Critical.', False),
    ]
    link = [
     ('Capacity exceedance (Q / Qfull)', "iif(abs(rptFlow) / fullFlow > 1, 2, iif(abs(rptFlow) / fullFlow > 0.9, 1, 0))", "type = 'CONDUIT'", [0, 1, 2],
      'Flow / Manning full-section flow > 0.9 Warning, > 1.0 High.', True),
     ('Depth exceedance (d / D)', "iif(rptCapacity > 0.9, 1, 0)", "type = 'CONDUIT'", [0, 1], 'Depth / full depth > 0.9 Warning.', False),
     ('Low velocity / sedimentation risk', f"iif(run({Lv}) >= 60, 2, iif({Lv}, 1, 0))", "type = 'CONDUIT'", [0, 1, 2],
      f"No rain, flowing, velocity < {u['vlow']} {u['V']}: Warning; continuously for 60 min or more: High. Tip: add  and tag = 'SAN'  (or your sewer-type field) to Where.", False),
     ('High velocity / scour risk', f"iif(abs(rptVel) > {u['vhigh']}, 1, 0)", "type = 'CONDUIT'", [0, 1], f"Velocity > {u['vhigh']} {u['V']} Warning.", False),
     ('Reverse flow (against the link direction)', f"iif({Rv}, iif(run({Rv}) > 5 or win({Rv}, 60) > 10, 2, 1), 0)", "type = 'CONDUIT'", [0, 1, 2],
      'Any reverse flow Warning; > 5 min without a break or > 10 min within an hour High. Direction = the link as drawn (model only, no monitoring data).', False),
     ('Dry-weather high depth (d / D > 0.5)', f"iif(run({Dw}) >= 30, 1, 0)", "type = 'CONDUIT'", [0, 1], 'No rain and d / D > 0.5 continuously for 30 min or more: Warning.', False),
     ('Tailwater sensitivity (outfall level near crown)', f"iif(dsInvert + diam - ds_rptHgl < 0, 2, iif(dsInvert + diam - ds_rptHgl < {u['tw']}, 1, 0))", "ds_type = 'OUTFALL'", [0, 1, 2],
      f"Conduits discharging to an outfall: outfall water level within {u['tw']} {u['L']} of the pipe crown Warning, above the crown High.", False),
    ]
    sub = [
     ('Slow-draining subcatchment (runoff > 120 min after rain)', f"iif(run({Rc}) > 120, 1, 0)", "", [0, 1],
      'Runoff continues more than 120 min after the rain on the subcatchment has stopped. Edit 120 to suit (e.g. twice the typical recession time).', False),
    ]
    L = {}
    for layer, arr in (('node', node), ('link', link), ('sub', sub)):
        subs = []
        for name, ex, wh, lv, d, en in arr:
            subs.append(item(layer, '⚑ ' + name, ex, wh, lv, d, en))
        for name, ex, wh, lv, d, en in arr:   # whole-run worst level (static, outside play mode)
            subs.append(item(layer, '⚑ ' + name + ' – worst over run', 'peak(' + ex + ')', wh, lv, 'Highest level reached during the simulation. ' + d, en))
        L[layer] = {'subs': subs, 'labels': {'on': False, 'fields': ['id']}}
    return L
for k, u in U.items():
    doc = {'osemcmTheme': 1, 'insight': 'Avaris2 Insight Flags v1', 'units': k + ' (' + u['L'] + ', ' + u['V'] + ')',
           'notes': 'Load in Layer Theme Editor -> Load... -> Add. Flags marked play show in play mode (current time step); "worst over run" show outside play mode. Levels: 0 Normal, 1 Warning, 2 High, 3 Critical. Times in minutes; accuracy = report time step.',
           'layers': flags(u)}
    with open(os.path.join(out_dir, f'Avaris2_Insight_Flags_{k}.json'), 'w', encoding='utf-8') as f: json.dump(doc, f, ensure_ascii=False, indent=1)
print('ok')
