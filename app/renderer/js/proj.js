// Minimal map projection engine (Snyder, "Map Projections - A Working Manual", USGS PP 1395)
// Geographic, Transverse Mercator (UTM, State Plane TM), Lambert Conformal Conic 1SP/2SP, Mercator / Web Mercator.
'use strict';
(function (AV) {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const P = {};

  P.presetWKT = (k) => {
    if (k === 'GEO') return 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]';
    if (k === 'WEBM') return 'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0],PARAMETER["False_Northing",0],PARAMETER["Central_Meridian",0],UNIT["Meter",1]]';
    const z = +k.slice(3);
    return 'PROJCS["UTM_Zone_' + z + 'N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000],PARAMETER["False_Northing",0],PARAMETER["Central_Meridian",' + (-183 + 6 * z) + '],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0],UNIT["Meter",1]]';
  };

  P.parse = function (wkt) {
    wkt = String(wkt || '').trim();
    if (!wkt) throw new Error('empty coordinate system');
    const sph = /SPHEROID\s*\[\s*"[^"]*"\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)/i.exec(wkt);
    const a = sph ? +sph[1] : 6378137, rf = sph ? +sph[2] : 298.257223563;
    const f = rf > 0 ? 1 / rf : 0, e2 = 2 * f - f * f;
    const isProj = /^\s*PROJCS/i.test(wkt);
    const S = { a, e2, e: Math.sqrt(e2) };
    if (!isProj) { S.type = 'geographic'; return S; }
    const prm = (names, d) => { for (const n of names) { const m = new RegExp('PARAMETER\\s*\\[\\s*"' + n + '"\\s*,\\s*([\\d.eE+-]+)', 'i').exec(wkt); if (m) return +m[1]; } return d; };
    // linear unit = last UNIT[...] in the string (projection unit)
    const units = [...wkt.matchAll(/UNIT\s*\[\s*"([^"]*)"\s*,\s*([\d.eE+-]+)/gi)];
    const u = units.length ? units[units.length - 1] : null;
    S.unit = u && !/degree/i.test(u[1]) ? +u[2] : 1;
    const proj = (/PROJECTION\s*\[\s*"([^"]+)"/i.exec(wkt) || [, ''])[1].toLowerCase();
    S.x0 = prm(['false_easting'], 0) * S.unit; S.y0 = prm(['false_northing'], 0) * S.unit;
    S.lon0 = prm(['central_meridian', 'longitude_of_origin', 'longitude_of_center'], 0) * D2R;
    S.lat0 = prm(['latitude_of_origin', 'latitude_of_center'], 0) * D2R;
    S.k0 = prm(['scale_factor'], 1);
    if (proj.includes('transverse_mercator')) S.type = 'tm';
    else if (proj.includes('lambert_conformal_conic')) {
      S.type = 'lcc';
      S.lat1 = prm(['standard_parallel_1'], NaN) * D2R; S.lat2 = prm(['standard_parallel_2'], NaN) * D2R;
      if (!isFinite(S.lat1)) S.lat1 = S.lat0; if (!isFinite(S.lat2)) S.lat2 = S.lat1;
    } else if (proj.includes('mercator_auxiliary_sphere') || proj.includes('pseudo_mercator') || /3857|web_mercator/i.test(wkt)) { S.type = 'merc'; S.sphere = true; }
    else if (proj.includes('mercator')) { S.type = 'merc'; S.lat1 = prm(['standard_parallel_1'], 0) * D2R; }
    else throw new Error('projection "' + proj + '" is not supported');
    if (S.type === 'tm') { const e2 = S.e2; S.ep2 = e2 / (1 - e2); S.M0 = M(S, S.lat0); }
    if (S.type === 'lcc') {
      const m = (p) => Math.cos(p) / Math.sqrt(1 - S.e2 * Math.sin(p) ** 2);
      const t = (p) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - S.e * Math.sin(p)) / (1 + S.e * Math.sin(p)), S.e / 2);
      const m1 = m(S.lat1), m2 = m(S.lat2), t1 = t(S.lat1), t2 = t(S.lat2), t0 = t(S.lat0);
      S.n = Math.abs(S.lat1 - S.lat2) < 1e-10 ? Math.sin(S.lat1) : (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
      S.F = m1 / (S.n * Math.pow(t1, S.n)); S.rho0 = S.a * S.F * Math.pow(t0, S.n) * S.k0; S.tf = t;
    }
    return S;
  };
  function M(S, phi) {
    const e2 = S.e2, e4 = e2 * e2, e6 = e4 * e2;
    return S.a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi) + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
  }
  P.fromGeo = function (S, lon, lat) {
    if (S.type === 'geographic') return [lon, lat];
    const phi = lat * D2R, lam = lon * D2R;
    let x, y;
    if (S.type === 'tm') {
      const N = S.a / Math.sqrt(1 - S.e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = S.ep2 * Math.cos(phi) ** 2, A = (lam - S.lon0) * Math.cos(phi);
      const Mv = M(S, phi);
      x = S.k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * S.ep2) * A ** 5 / 120);
      y = S.k0 * (Mv - S.M0 + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * S.ep2) * A ** 6 / 720));
    } else if (S.type === 'lcc') {
      const rho = S.a * S.F * Math.pow(S.tf(phi), S.n) * S.k0, th = S.n * (lam - S.lon0);
      x = rho * Math.sin(th); y = S.rho0 - rho * Math.cos(th);
    } else if (S.type === 'merc') {
      if (S.sphere) { x = S.a * (lam - S.lon0); y = S.a * Math.log(Math.tan(Math.PI / 4 + phi / 2)); }
      else { const k = Math.cos(S.lat1 || 0) / Math.sqrt(1 - S.e2 * Math.sin(S.lat1 || 0) ** 2); x = S.a * k * (lam - S.lon0); y = S.a * k * Math.log(Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - S.e * Math.sin(phi)) / (1 + S.e * Math.sin(phi)), S.e / 2)); }
    }
    return [(x + S.x0) / S.unit, (y + S.y0) / S.unit];
  };
  P.toGeo = function (S, X, Y) {
    if (S.type === 'geographic') return [X, Y];
    const x = X * S.unit - S.x0, y = Y * S.unit - S.y0;
    let phi, lam;
    if (S.type === 'tm') {
      const e2 = S.e2, Mv = S.M0 + y / S.k0, mu = Mv / (S.a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
      const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
      const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
      const C1 = S.ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = S.a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = S.a * (1 - e2) / Math.pow(1 - e2 * Math.sin(p1) ** 2, 1.5), Dd = x / (N1 * S.k0);
      phi = p1 - (N1 * Math.tan(p1) / R1) * (Dd * Dd / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * S.ep2) * Dd ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * S.ep2 - 3 * C1 * C1) * Dd ** 6 / 720);
      lam = S.lon0 + (Dd - (1 + 2 * T1 + C1) * Dd ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * S.ep2 + 24 * T1 * T1) * Dd ** 5 / 120) / Math.cos(p1);
    } else if (S.type === 'lcc') {
      const sgn = S.n < 0 ? -1 : 1; const rho = sgn * Math.hypot(x, S.rho0 - y); const th = Math.atan2(sgn * x, sgn * (S.rho0 - y));
      const t = Math.pow(rho / (S.a * S.F * S.k0), 1 / S.n);
      phi = Math.PI / 2 - 2 * Math.atan(t);
      for (let i = 0; i < 15; i++) { const es = S.e * Math.sin(phi); const np = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - es) / (1 + es), S.e / 2)); if (Math.abs(np - phi) < 1e-12) { phi = np; break; } phi = np; }
      lam = th / S.n + S.lon0;
    } else {
      if (S.sphere) { lam = x / S.a + S.lon0; phi = Math.PI / 2 - 2 * Math.atan(Math.exp(-y / S.a)); }
      else {
        const k = Math.cos(S.lat1 || 0) / Math.sqrt(1 - S.e2 * Math.sin(S.lat1 || 0) ** 2); lam = x / (S.a * k) + S.lon0; const t = Math.exp(-y / (S.a * k));
        phi = Math.PI / 2 - 2 * Math.atan(t); for (let i = 0; i < 15; i++) { const es = S.e * Math.sin(phi); phi = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - es) / (1 + es), S.e / 2)); }
      }
    }
    return [lam * R2D, phi * R2D];
  };
  AV.Proj = P;
})(window.AV);
