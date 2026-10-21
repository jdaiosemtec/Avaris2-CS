import re,os,shutil
from PIL import Image
B='build/'; shutil.rmtree(B,ignore_errors=True); os.makedirs(B+'images'); os.makedirs(B+'media')
s=''.join(open(f).read() for f in ['shell_head.html','c1.html','c2.html','c3.html','c4.html','c5.html','c6.html','c7.html','c8.html','c9.html','shell_tail.html'])
refs=sorted(set(re.findall(r'(?:src|poster)="((?:images|media)/[^"]+)"',s)))
missing=[r for r in refs if not os.path.exists(r)]; print('refs',len(refs),'missing',missing)
tot=0
for r in refs:
    if r.startswith('media/'): shutil.copy(r,B+r); tot+=os.path.getsize(B+r); continue
    im=Image.open(r); w,h=im.size
    if r.endswith('.jpg') or (r.endswith('.png') and w*h>300000):
        out=r.rsplit('.',1)[0]+'.webp'; im.convert('RGB').save(B+out,'WEBP',quality=88 if r.endswith('.png') else 82,method=6); s=s.replace('"'+r+'"','"'+out+'"'); tot+=os.path.getsize(B+out)
    else: im.save(B+r, optimize=True); tot+=os.path.getsize(B+r)
open(B+'index.html','w').write(s); print('MB',round(tot/1e6,1),'topics',s.count('class="topic"'))
