"""Arrange actual Blender renders into a compact, labelled review sheet."""
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output'
fontpath='C:/Windows/Fonts/msyh.ttc'
title=ImageFont.truetype(fontpath,32);label=ImageFont.truetype(fontpath,23)
tiles=[('Skye_Smile.png','开心微笑'),('Skye_Curious.png','好奇张望'),('Skye_Wink.png','俏皮眨眼'),
       ('Skye_Bow.png','邀请玩耍'),('Skye_Wave.png','抬爪招呼'),('Skye_Flight.png','展翼起飞')]
margin=24;tw=368;th=433;gap=24;caption=46;header=92
canvas=Image.new('RGB',(3*tw+2*gap+2*margin,header+2*(th+caption)+gap+margin),'#253440')
draw=ImageDraw.Draw(canvas)
draw.text((margin,22),'天天 / SKYE · 动作与表情 v2.1',font=title,fill='#fff3e8')
for i,(name,text) in enumerate(tiles):
    pic=Image.open(OUT/name).convert('RGB');pic.thumbnail((tw,th),Image.Resampling.LANCZOS)
    x=margin+(i%3)*(tw+gap);y=header+(i//3)*(th+caption+gap)
    canvas.paste(pic,(x+(tw-pic.width)//2,y+(th-pic.height)//2))
    draw.text((x,y+th+9),text,font=label,fill='#f9e3e9')
canvas.save(OUT/'Skye_Expressions.jpg',quality=93,subsampling=0)
print(OUT/'Skye_Expressions.jpg')
