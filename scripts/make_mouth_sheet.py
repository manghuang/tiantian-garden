"""Compose three actual mouth-detail renders without altering their contents."""
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output'
font='C:/Windows/Fonts/msyh.ttc'
canvas=Image.new('RGB',(1200,600),'#253440');draw=ImageDraw.Draw(canvas)
draw.text((24,20),'天天 / SKYE · 自然张合',font=ImageFont.truetype(font,30),fill='#fff3e8')
for i,(name,label) in enumerate([('Closed','闭合'),('Small','微张'),('Open','张开')]):
    pic=Image.open(OUT/f'Skye_Mouth_{name}.png').convert('RGB');pic.thumbnail((368,433),Image.Resampling.LANCZOS)
    x=24+i*392;canvas.paste(pic,(x,82))
    draw.text((x,536),label,font=ImageFont.truetype(font,25),fill='#f9e3e9')
canvas.save(OUT/'Skye_Mouth_States.jpg',quality=94,subsampling=0)
print(OUT/'Skye_Mouth_States.jpg')
