# Replace the application icon images inside a PE (.exe) in place: every RT_ICON image of the main icon group is
# overwritten with a PNG of the same size (PNG is always smaller than the 32-bit DIB it replaces), and the
# group directory sizes are updated. The Authenticode certificate (if any) is removed because it no longer matches.
import struct,sys,io
from PIL import Image
exe,src,out=sys.argv[1],sys.argv[2],sys.argv[3] if len(sys.argv)>3 else None
b=bytearray(open(exe,'rb').read())
pe=struct.unpack_from('<I',b,0x3c)[0]; assert b[pe:pe+4]==b'PE\0\0'
nsec=struct.unpack_from('<H',b,pe+6)[0]; optsz=struct.unpack_from('<H',b,pe+20)[0]; opt=pe+24
magic=struct.unpack_from('<H',b,opt)[0]; dd=opt+(112 if magic==0x20b else 96)
rsrc_rva,rsrc_sz=struct.unpack_from('<II',b,dd+2*8); cert_off,cert_sz=struct.unpack_from('<II',b,dd+4*8)
secs=[]; so=opt+optsz
for i in range(nsec):
    name,vs,va,rs,ra=struct.unpack_from('<8sIIII',b,so+i*40)[:5]; secs.append((va,max(vs,rs),ra))
def off(rva):
    for va,sz,ra in secs:
        if va<=rva<va+sz: return rva-va+ra
    raise Exception('rva')
base=off(rsrc_rva)
def entries(d):
    n=sum(struct.unpack_from('<HH',b,base+d+12)); r=[]
    for i in range(n):
        nid,o=struct.unpack_from('<II',b,base+d+16+i*8); r.append((nid,o))
    return r
def leaves(typeid):
    res={}
    for nid,o in entries(0):
        if nid==typeid:
            for nid2,o2 in entries(o&0x7fffffff):
                for nid3,o3 in entries(o2&0x7fffffff):
                    res[nid2]=o3  # data entry offset
    return res
icons=leaves(3); groups=leaves(14)
print('cert',cert_off,cert_sz,'icons',len(icons),'groups',list(groups)[:5])
gid=sorted(groups)[0]; de=groups[gid]; grva,gsz=struct.unpack_from('<II',b,base+de); g=off(grva)
cnt=struct.unpack_from('<H',b,g+4)[0]; img=Image.open(src).convert('RGBA')
for i in range(cnt):
    e=g+6+i*14; w,hh,cc,res,planes,bpp,size,iid=struct.unpack_from('<BBBBHHIH',b,e); W=w or 256; H=hh or 256
    ide=icons[iid]; irva,isz=struct.unpack_from('<II',b,base+ide); io_=off(irva)
    r=img.resize((W,H),Image.LANCZOS); bio=io.BytesIO(); r.save(bio,'PNG',optimize=True); data=bio.getvalue()
    for ncol in (256,192,128,96,64):   # palette PNG when the full-colour one does not fit the slot
        if len(data)<=isz: break
        bio=io.BytesIO(); r.quantize(ncol,method=Image.Quantize.FASTOCTREE).save(bio,'PNG',optimize=True); data=bio.getvalue()
    if len(data)>isz: print('skip',W,len(data),isz); continue
    b[io_:io_+isz]=data+b'\0'*(isz-len(data)); struct.pack_into('<I',b,base+ide+4,len(data))
    struct.pack_into('<HHI',b,e+4,1,32,len(data)); print('icon',iid,W,H,'old',isz,'new',len(data))
if cert_sz:
    struct.pack_into('<II',b,dd+4*8,0,0); b=b[:cert_off] if cert_off+cert_sz>=len(b)-8 else b
open(out or exe,'wb').write(b)
