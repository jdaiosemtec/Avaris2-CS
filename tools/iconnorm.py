# Optical size normalisation of the ribbon icons: crop to content, scale so the geometric mean of the content box
# (corrected a little for ink density) is the same for every icon, long side capped; centre on a 64x64 canvas.
import sys,glob,os
from PIL import Image,ImageDraw
src,dst=sys.argv[1],sys.argv[2]; C=64; T=float(sys.argv[3]) if len(sys.argv)>3 else 0.80
rows=[]
for f in sorted(glob.glob(src+'/*.png')):
    im=Image.open(f).convert('RGBA'); a=im.split()[3]; bb=a.point(lambda v:255 if v>40 else 0).getbbox()
    c=im.crop(bb); w,h=c.size; ink=sum(1 for v in c.split()[3].getdata() if v>128)/(w*h)
    gm=(w*h)**0.5; k=(ink/0.45)**0.12      # denser (filled) icons look bigger
    s=T*C/(gm*k); s=min(s,1.0*C/max(w,h))
    nw,nh=max(1,round(w*s)),max(1,round(h*s))
    r=c.resize((nw,nh),Image.LANCZOS); o=Image.new('RGBA',(C,C),(0,0,0,0)); o.paste(r,((C-nw)//2,(C-nh)//2),r)
    o.save(os.path.join(dst,os.path.basename(f))); rows.append((os.path.basename(f),nw,nh,round(ink,2)))
for r in rows: print(*r)
