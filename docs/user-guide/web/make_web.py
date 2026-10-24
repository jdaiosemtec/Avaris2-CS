# Builds the osemtec.com page avaris.html from the guide chapters (c*.html) and the website template
# (web/avaris_template.html = the page as on the website). The template's navigation bar, search, sidebar / page
# logic, CSS classes and scripts are kept; the sidebar, the pages and the page list (pageMapping) are generated.
# Conceptual Model pages of the template (theory, still valid) are kept. Output: web/out/avaris.html and
# web/out/images/avaris2cs/*, web/out/media/avaris2cs/* – upload the contents of web/out to the website root.
#   python3 web/make_web.py            (run in docs/user-guide)
import re, os, shutil, json, sys
from bs4 import BeautifulSoup, NavigableString, Comment
from PIL import Image

VERSION = 'Avaris2 CS ' + json.load(open('../../app/package.json'))['version']
OUT = 'web/out/'; IMG = 'images/avaris2cs/'; MED = 'media/avaris2cs/'
CHAPTERS = ['c1', 'c2', 'c3', 'c4', 'c4_props', 'c5', 'c5_detail', 'c6', 'c7', 'c7_opts', 'c7b', 'c7c', 'c8', 'c9']
# guide topic id -> page id of the template where the template already had that page
IDMAP = {'home': 'intro-avaris', 'requirements': 'sysreq', 'ui-overview': 'qs-overview', 'ribbon': 'qs-maintoolbar',
         'parameter-view': 'parameterview', 'map-view': 'studyarea', 'properties': 'propertybrowser'}
KEEP_TEMPLATE = lambda pid: pid.startswith('cm-')   # template pages kept as they are (Conceptual Model)

tpl = open('web/avaris_template.html', encoding='utf-8').read()

# ---------------------------------------------------------------- read the guide topics
topics = []   # (pid, title, chapter, section-tag)
for c in CHAPTERS:
    if not os.path.exists(c + '.html'): print('skip', c); continue
    soup = BeautifulSoup(open(c + '.html', encoding='utf-8').read(), 'html.parser')
    for sec in soup.find_all('section', class_='topic'):
        tid = sec['id']; topics.append((IDMAP.get(tid, tid), sec.get('data-title') or sec.find('h1').get_text(), sec.get('data-ch'), sec, tid))
pid_of = {}   # any id (topic or element inside) -> page id
for pid, title, ch, sec, tid in topics:
    pid_of[tid] = pid
    for el in sec.find_all(id=True): pid_of.setdefault(el['id'], pid)
title_of = {pid: t for pid, t, ch, sec, tid in topics}
by_ch = {}
for pid, t, ch, sec, tid in topics: by_ch.setdefault(ch, []).append(pid)

# ---------------------------------------------------------------- template pages kept
tsoup = BeautifulSoup(tpl, 'html.parser')
main = tsoup.find('div', class_='content-main')
kept = {}
for pg in main.find_all('div', class_='page', recursive=False):
    pid = pg['id'][5:]
    if KEEP_TEMPLATE(pid): kept[pid] = pg
tmap = {}
m = re.search(r'const pageMapping = \{(.*?)\n    \};', tpl, re.S)
for k, t, p in re.findall(r"'([^']+)':\s*\{\s*title:\s*'([^']*)',\s*parent:\s*'([^']*)'\s*\}", m.group(1)): tmap[k] = (t, p)

# ---------------------------------------------------------------- sidebar layout
G = lambda ch: by_ch.get(ch, [])
SIDEBAR = [
    ('Set Up', ['intro-avaris', 'sysreq', 'install', 'signin']),
    ('Licensing', ['licensing', 'lic-request']),
    ('Quick-Start Tutorials', ['quickstart']),
    ('Conceptual Model', 'TEMPLATE'),
    ('Main Window', G('The user interface')),
    ('Project Setup', G('Projects and data')),
    ('Map Operation', G('Editing the network')),
    ('Tools', G('Tools')),
    ('Parameters Editing', G('Model parameters')),
    ('Properties Editing', G('Object properties')),
    ('Simulation and Analysis', [x for x in G('Simulation') if not x.startswith('opt-')] + ([('Options Settings', [x for x in G('Simulation') if x.startswith('opt-')])] if any(x.startswith('opt-') for x in G('Simulation')) else [])),
    ('2D Flood Modelling', G('2D flood modelling')),
    ('High Performance Simulation', G('High Performance Simulation')),
    ('Auto Calibration', G('Auto Calibration')),
    ('Results and Analysis', G('Results and analysis')),
    ('Reference', G('Reference')),
]
placed = set()
for g, items in SIDEBAR:
    if items == 'TEMPLATE': continue
    for it in items: placed.update(it[1] if isinstance(it, tuple) else [it])
missing = [pid for pid, *_ in topics if pid not in placed]
if missing: print('NOT IN SIDEBAR', missing); sys.exit(1)

# the template's Conceptual Model block (nested groups) is taken as it is
side_html = tpl[tpl.index('id="sidebar">') + len('id="sidebar">'):tpl.index('<div class="back-to-top"')]
side_html = side_html[:side_html.rindex('</div>')]
i = side_html.index('Conceptual Model'); a0 = side_html.rindex('<div class="sidebar-group">', 0, i); a1 = side_html.index('<div class="sidebar-group">', i)
cm_block = side_html[a0:a1].strip()
assert cm_block.count('showPage(') > 30, 'Conceptual Model block not found'

def esc(s): return s.replace('&', '&amp;').replace('<', '&lt;')
def link(pid, cls=''):
    return f'<a href="#" onclick="showPage(\'{pid}\'); return false;" id="nav-{pid}">{esc(title_of[pid])}</a>'
mapping = {}
out_side = []
for g, items in SIDEBAR:
    if items == 'TEMPLATE':
        out_side.append(cm_block.strip())
        for k, (t, p) in tmap.items():
            if k.startswith('cm-') and k in kept: mapping[k] = (t, p)
        continue
    if not items: continue
    rows = []
    for it in items:
        if isinstance(it, tuple):
            nt, sub = it
            rows.append(f'<div class="sidebar-nested-title" onclick="toggleNestedGroup(this)"><span class="sub-arrow"></span> {esc(nt)}</div>')
            rows.append('<div class="sidebar-sub2">\n' + '\n'.join('                ' + link(x) for x in sub) + '\n              </div>')
            for x in sub: mapping[x] = (title_of[x], nt)
        else:
            rows.append(link(it)); mapping[it] = (title_of[it], g)
    out_side.append(f'''<div class="sidebar-group">
            <div class="sidebar-group-title" onclick="toggleGroup(this)"><span class="arrow"></span> {esc(g)}</div>
            <div class="sidebar-sub">
              ''' + '\n              '.join(rows) + '''
            </div>
          </div>''')
new_side = '\n\n          '.join(out_side)

# ---------------------------------------------------------------- convert the topics into pages
imgs = set(); media = set()
def conv_img(src):
    if src.startswith('media/'): media.add(src); return './' + MED + src[6:]
    if src.startswith('images/'):
        imgs.add(src); name = src[7:]
        if src.endswith('.jpg') or (src.endswith('.png') and Image.open(src).size[0] * Image.open(src).size[1] > 300000): name = name.rsplit('.', 1)[0] + '.webp'
        return './' + IMG + name
    return src
TIDS = {tid for _, _, _, _, tid in topics}
def onclick(target):
    if target not in pid_of: return None
    p = pid_of[target]
    return f"showPage('{p}'); return false;" if target in TIDS else f"showPageAt('{p}', '{target}'); return false;"

def convert(pid, sec):
    s = BeautifulSoup('', 'html.parser')
    for c in sec.find_all(string=lambda t: isinstance(t, Comment)): c.extract()
    # links
    for a in sec.find_all('a', href=True):
        h = a['href']
        if h.startswith('#'):
            oc = onclick(h[1:])
            if oc: a['href'] = '#'; a['onclick'] = oc
            else: a.unwrap()
        elif a.get('class') == ['card']: pass
    # inline
    for sp in sec.find_all('span', class_='ui'): sp.name = 'strong'; del sp['class']
    for b in sec.find_all('span', class_='badge'): b.name = 'strong'; del b['class']; b.wrap(s.new_tag('p'))
    for h2 in sec.find_all('h2'): h2['class'] = 'avaris-h2'
    for h3 in sec.find_all('h3'): h3['class'] = 'avaris-h3'
    for p in sec.find_all('p', class_='lead'): del p['class']
    for ol in sec.find_all('ol', class_='steps'): del ol['class']
    # tables
    for tw in sec.find_all('div', class_='tablewrap'):
        tw['class'] = 'avaris-table-wrapper'; t = tw.find('table'); t['class'] = 'avaris-table'
        rows = t.find_all('tr', recursive=False)
        if rows and rows[0].find('th'):
            thead = s.new_tag('thead'); tbody = s.new_tag('tbody'); rows[0].extract(); thead.append(rows[0])
            for r in rows[1:]: r.extract(); tbody.append(r)
            t.append(thead); t.append(tbody)
        for c in t.find_all(['th', 'td']): c['class'] = 'align-left'; c['style'] = 'vertical-align: middle;'
    # callouts
    for co in sec.find_all('div', class_='callout'):
        cls = co.get('class', []); bt = co.find('b', class_='t'); label = bt.get_text().strip(' :') if bt else 'Note'
        if bt: bt.extract()
        kind = 'tip-box' if 'tip' in cls else 'note-box'
        icon = '💡' if kind == 'tip-box' else '⚠️'
        co['class'] = kind; title = s.new_tag('div', attrs={'class': 'note-title'}); title.string = f'{icon} {label}'; co.insert(0, title)
    # cards -> list
    for cd in sec.find_all('div', class_='cards'):
        ul = s.new_tag('ul')
        for a in cd.find_all('a', class_='card'):
            li = s.new_tag('li'); na = s.new_tag('a', attrs={'href': '#', 'onclick': a.get('onclick') or onclick(a['href'][1:]) or ''})
            st = s.new_tag('strong'); st.string = a.find('b').get_text(); na.append(st); li.append(na); li.append(' – ' + a.find('span').get_text()); ul.append(li)
        cd.replace_with(ul)
    # figures
    for fg in sec.find_all('figure'):
        cls = fg.get('class', []); w = '45%' if 'small' in cls else '70%' if 'narrow' in cls else '100%'
        cap = fg.find('figcaption'); box = s.new_tag('div')
        for im in fg.find_all('img'):
            im['src'] = conv_img(im['src']); im['style'] = f'max-width: {w}; height: auto; display: block; margin: 20px auto; border: 1px solid #ddd; border-radius: 4px;'; box.append(im.extract())
        for v in fg.find_all('video'):
            if v.get('poster'): v['poster'] = conv_img(v['poster'])
            for so in v.find_all('source'): so['src'] = conv_img(so['src'])
            v['style'] = 'max-width: 100%; display: block; margin: 20px auto; border: 1px solid #ddd; border-radius: 4px;'; box.append(v.extract())
        if cap:
            p = s.new_tag('p', attrs={'style': 'text-align:center;font-size:12px;color:#666;'})
            for ch in list(cap.contents): p.append(ch.extract())
            box.append(p)
        fg.replace_with(*box.contents)
    for im in sec.find_all('img'):
        if not im['src'].startswith('./'): im['src'] = conv_img(im['src'])
    h1 = sec.find('h1'); h1.extract()
    # remove the guide's own class attributes left over
    for el in sec.find_all(class_=True):
        el['class'] = [c for c in (el['class'] if isinstance(el['class'], list) else [el['class']]) if c in ('avaris-h2', 'avaris-h3', 'avaris-table-wrapper', 'avaris-table', 'align-left', 'note-box', 'tip-box', 'note-title')]
        if not el['class']: del el['class']
    body = ''.join(str(x) for x in sec.contents).strip()
    return f'''          <div class="page" id="page-{pid}">
            <h1>{esc(h1.get_text())}</h1>
            <div class="version-bar"><span>{VERSION}</span></div>
{body}
          </div>
'''

pages = []
for pid, t, ch, sec, tid in topics: pages.append(convert(pid, sec))
for pid, pg in kept.items():
    for vb in pg.find_all('div', class_='version-bar'): vb.clear(); sp = tsoup.new_tag('span'); sp.string = VERSION; vb.append(sp)
    for tn in pg.find_all(string=True):
        if 'Avaris CS' in tn and tn.parent.name not in ('script', 'style'): tn.replace_with(tn.replace('Avaris CS', 'Avaris2 CS'))
    pages.append('          ' + str(pg) + '\n')
content = '\n'.join(pages)
if re.search(r'(?i)swmm', content): print('WARNING: SWMM/EPA mentioned:', list(set(re.findall(r'(?i).{60}(?:swmm).{40}', content)))[:8])

# ---------------------------------------------------------------- assemble
out = tpl
a = out.index('id="sidebar">') + len('id="sidebar">'); b = out.index('<div class="back-to-top"'); b = out.rindex('</div>', 0, b)
out = out[:a] + '\n\n          ' + new_side + '\n\n        ' + out[b:]
a = out.index('<div class="content-main">') + len('<div class="content-main">'); b = out.index('<div class="content-toc">'); b = out.rindex('</div>', 0, b)
out = out[:a] + '\n\n' + content + '\n        ' + out[b:]
pm = ',\n'.join(f"      '{k}': {{ title: {json.dumps(t)}, parent: {json.dumps(p)} }}" for k, (t, p) in mapping.items())
out = re.sub(r'const pageMapping = \{.*?\n    \};', lambda m_: 'const pageMapping = {\n' + pm + '\n    };', out, count=1, flags=re.S)
helper = '''
    // open a page and scroll to a heading on it (links to a section of another page)
    function showPageAt(pageId, anchorId) {
      showPage(pageId);
      setTimeout(() => { const el = document.getElementById(anchorId); if (el) { const top = el.getBoundingClientRect().top + window.pageYOffset - 90; window.scrollTo({ top, behavior: 'smooth' }); } }, 450);
    }
'''
out = out.replace('    function updateBreadcrumb(pageId) {', helper + '\n    function updateBreadcrumb(pageId) {', 1)
out = out.replace('<span>Avaris CS</span> <span class="sep">/</span>', '<span>Avaris2 CS</span> <span class="sep">/</span>')
out = out.replace('placeholder="Search Avaris CS help"', 'placeholder="Search Avaris2 CS help"')
out = out.replace('<h1 class="hero-title">Avaris CS<span', '<h1 class="hero-title">Avaris2 CS<span')
out = out.replace('modeling with Avaris\n          DS.</p>', 'modeling with Avaris2 CS.</p>')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT + IMG); os.makedirs(OUT + MED)
open(OUT + 'avaris.html', 'w', encoding='utf-8').write(out)
tot = 0
for r in sorted(imgs):
    im = Image.open(r); w, h = im.size; name = r[7:]
    if r.endswith('.jpg') or (r.endswith('.png') and w * h > 300000):
        name = name.rsplit('.', 1)[0] + '.webp'; im.convert('RGB').save(OUT + IMG + name, 'WEBP', quality=88 if r.endswith('.png') else 82, method=6)
    else: im.save(OUT + IMG + name, optimize=True)
    tot += os.path.getsize(OUT + IMG + name)
for r in sorted(media): shutil.copy(r, OUT + MED + r[6:]); tot += os.path.getsize(OUT + MED + r[6:])
print('pages', len(pages), 'guide topics', len(topics), 'kept template pages', len(kept), 'images', len(imgs), 'media', len(media), 'MB', round(tot / 1e6, 1))
