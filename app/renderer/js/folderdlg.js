// Folder picker inside the program (the Windows folder dialog cannot get extra buttons): places on the left,
// the sub-folders of the current folder, path bar, Up, and New Folder next to Select Folder.
//   AV.folderDialog({ title, defaultPath }) -> chosen folder (absolute path) or null
'use strict';
(function (AV) {
  const h = AV.h;
  const isWin = () => /win/i.test(navigator.platform || '') || /Windows/i.test(navigator.userAgent || '');
  const parentOf = (p) => { const s = p.replace(/[\\/]+$/, ''); if (/^[a-z]:$/i.test(s)) return null; const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/')); if (i < 0) return null;
    const up = s.slice(0, i); return up === '' ? '/' : /^[a-z]:$/i.test(up) ? up + '\\' : up; };
  const join = (d, n) => AV.joinPath(d, n);
  const BAD = /[\\/:*?"<>|]/;

  AV.folderDialog = async function (opts = {}) {
    let places = null; try { places = await window.host.places(); } catch (e) { places = null; }
    let cur = opts.defaultPath || (places && places.documents) || '';
    // start in the nearest existing folder
    while (cur && !(await window.host.exists(cur))) { const up = parentOf(cur); if (!up || up === cur) { cur = ''; break; } cur = up; }
    if (!cur) cur = (places && (places.documents || places.home)) || '/';
    let entries = [], sel = null, editing = false, err = '';
    const pathIn = h('input', { type: 'text', class: 'fdpath', value: cur, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(pathIn.value.trim()); } } });
    const list = h('div', { class: 'fdlist' });
    const side = h('div', { class: 'fdside' });
    const status = h('div', { class: 'fdstatus' });
    const body = h('div', { class: 'fdlg' },
      h('div', { class: 'fdbar' }, h('button', { class: 'btn small', title: 'Up one level', onclick: () => { const up = parentOf(cur); if (up) go(up); else if (isWin()) go(''); } }, '↑'), pathIn,
        h('button', { class: 'btn small', title: 'Refresh', onclick: () => go(cur) }, '⟳')),
      h('div', { class: 'fdmain' }, side, list), status);
    const placeRow = (label, p, icon) => p ? h('div', { class: 'fdplace' + (cur === p ? ' on' : ''), title: p, onclick: () => go(p) }, h('span', { class: 'fdi' }, icon), label) : null;
    const renderSide = () => { side.innerHTML = ''; if (!places) return;
      side.append(placeRow('Model folder', opts.modelFolder, '★'), placeRow('Desktop', places.desktop, '🖥'), placeRow('Documents', places.documents, '📄'), placeRow('Downloads', places.downloads, '⬇'), placeRow('Home', places.home, '⌂'));
      if (places.drives && places.drives.length) { side.append(h('div', { class: 'fdsep' })); for (const d of places.drives) side.append(placeRow(d.replace(/\\$/, ''), d, '💽')); } };
    const render = () => {
      list.innerHTML = ''; pathIn.value = cur;
      const dirs = entries.filter(e => e.dir && !/^\./.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      if (editing) {
        const inp = h('input', { type: 'text', value: 'New folder', class: 'fdnew' });
        const commit = async () => { const nm = inp.value.trim(); if (!nm) { editing = false; render(); return; }
          if (BAD.test(nm) || /^\.+$/.test(nm)) { status.textContent = 'A folder name cannot contain \\ / : * ? " < > |'; status.className = 'fdstatus bad'; inp.focus(); return; }
          const p = join(cur, nm); if (await window.host.exists(p)) { status.textContent = 'A folder named "' + nm + '" already exists here.'; status.className = 'fdstatus bad'; inp.focus(); return; }
          try { await window.host.mkdir(p); } catch (e) { status.textContent = 'Could not create the folder: ' + e.message; status.className = 'fdstatus bad'; return; }
          editing = false; sel = p; await load(cur); status.textContent = 'Folder created: ' + nm; status.className = 'fdstatus'; };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = false; render(); } });
        inp.addEventListener('blur', () => { if (editing) commit(); });
        list.append(h('div', { class: 'fdrow sel' }, h('span', { class: 'fdi' }, '📁'), inp)); setTimeout(() => { inp.focus(); inp.select(); }, 0);
      }
      for (const d of dirs) { const p = join(cur, d.name);
        list.append(h('div', { class: 'fdrow' + (sel === p ? ' sel' : ''), title: p, onclick: () => { sel = p; render(); }, ondblclick: () => { sel = null; go(p); } }, h('span', { class: 'fdi' }, '📁'), h('span', null, d.name),
          h('span', { class: 'fdd' }, d.mtime ? new Date(d.mtime).toLocaleDateString() : ''))); }
      if (!dirs.length && !editing) list.append(h('div', { class: 'fdempty' }, err || 'No sub-folders. Select this folder, or create one with New Folder.'));
      renderSide();
    };
    const load = async (p) => { err = ''; try { entries = await window.host.listDir(p); } catch (e) { entries = []; err = 'Cannot open this folder: ' + e.message; } cur = p; render(); };
    const go = async (p) => { if (p === '' && places && places.drives) { cur = ''; entries = places.drives.map(d => ({ name: d.replace(/\\$/, ''), dir: true })); list.innerHTML = '';
        for (const d of places.drives) list.append(h('div', { class: 'fdrow', ondblclick: () => go(d) }, h('span', { class: 'fdi' }, '💽'), h('span', null, d))); pathIn.value = ''; return; }
      if (!p) return; if (!(await window.host.exists(p))) { status.textContent = 'Folder not found: ' + p; status.className = 'fdstatus bad'; return; } sel = null; editing = false; status.textContent = ''; status.className = 'fdstatus'; await load(p); };
    await load(cur);
    const M = AV.modal({ title: opts.title || 'Select Folder', width: 720, body, enterSubmits: false, buttons: [
      { label: 'New Folder', onClick: () => { if (!cur) return false; editing = true; render(); return false; } },
      { label: 'Cancel', value: null },
      { label: 'Select Folder', primary: true, onClick: () => { const p = sel || cur; if (!p) return false; return p; } }] });
    // New Folder sits at the left of the footer, like the file dialogs of Windows
    const f = M.el.querySelector('.mf'); if (f && f.firstChild) f.firstChild.style.marginRight = 'auto';
    return M.done;
  };
})(window.AV);
