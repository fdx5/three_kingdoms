"""Package Blender frame renders into review GIFs and a contact sheet (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT=Path(__file__).resolve().parents[2]/'artifacts/yanliang'
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',20)
for name,duration in [('walk',1000),('attack',750)]:
    files=sorted((OUT/name).glob('*.png'))
    if len(files)!=24:
        raise RuntimeError(f'{name}: expected 24 complete frames, got {len(files)}')
    frames=[]
    for file in files:
        image=Image.open(file).convert('RGB')
        draw=ImageDraw.Draw(image)
        draw.rectangle((0,0,480,36),fill=(10,15,22))
        draw.text((16,7),f'YAN LIANG  /  {name.upper()}',font=font,fill=(224,191,134))
        frames.append(image)
    frames[0].save(OUT/f'yanliang_{name}.gif',save_all=True,append_images=frames[1:],
        duration=round(duration/len(frames)/10)*10,loop=0,optimize=False,disposal=2)
sheet=Image.new('RGB',(1440,1120),(10,15,22))
for row,name in enumerate(['walk','attack']):
    for col,index in enumerate([0,7,12]):
        image=Image.open(OUT/name/f'{index:03}.png').convert('RGB')
        ImageDraw.Draw(image).text((16,12),f'{name.upper()}  {index+1:02}/24',font=font,fill=(224,191,134))
        sheet.paste(image,(col*480,row*560))
sheet.save(OUT/'yanliang_motion_sheet.jpg',quality=93)
