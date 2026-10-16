import sys, subprocess, numpy as np, cv2
src = sys.argv[1]
W,H=1920,1080
p = subprocess.Popen(['ffmpeg','-v','error','-i',src,'-f','rawvideo','-pix_fmt','gray','-'],stdout=subprocess.PIPE)
scores=[]; low=[]
i=0
while True:
    b=p.stdout.read(W*H)
    if len(b)<W*H: break
    g=np.frombuffer(b,np.uint8).reshape(H,W).astype(np.int16)
    def sc(y0,y1,x0=0,x1=W):
        band=g[y0:y1,x0:x1]
        bl=cv2.blur(band.astype(np.uint8),(15,15)).astype(np.int16)
        m=(band>200)&((band-bl)>45)
        return int(m.sum())
    scores.append((sc(400,560), sc(760,880,0,700)))
    i+=1
np.save(sys.argv[2], np.array(scores))
