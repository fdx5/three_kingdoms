"""Rebuild Yan Liang: Blender-native armoured infantry, rig, game clips and studio renders.
Run with blender --background --python scripts/blender/create_yanliang.py
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector, Euler

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/yanliang'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
scene = bpy.context.scene
scene.render.fps = 60
parts = []

def material(name, color, metal=0, rough=.45):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    return mat

IRON = material('01 | blued forged steel', (.065, .105, .14), .82, .28)
EDGE = material('02 | worn brass edging', (.5, .285, .085), .78, .3)
SILVER = material('03 | honed blade', (.5, .61, .67), .9, .2)
RED = material('04 | oxblood silk', (.24, .015, .022), .05, .58)
CLOTH = material('05 | indigo undercoat', (.022, .038, .065), 0, .85)
LEATHER = material('06 | dark saddle leather', (.07, .036, .02), .05, .68)
SKIN = material('07 | warm weathered skin', (.46, .25, .155), 0, .54)
HAIR = material('08 | beard and hair', (.018, .009, .006), 0, .8)
EYE = material('09 | ivory', (.7, .66, .53), 0, .36)
BLACK = material('10 | obsidian eyes', (.003, .004, .006), .05, .2)

def finish(obj, name, mat, bone, bevel=0):
    obj.name = name
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Forged edge bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    if bone:
        group = obj.vertex_groups.new(name=bone)
        group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    parts.append(obj)
    return obj

def ell(name, loc, scale, mat, bone, seg=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.scale = scale
    return finish(obj, name, mat, bone)

def box(name, loc, scale, mat, bone, bevel=.012):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.scale = scale
    return finish(obj, name, mat, bone, bevel)

def rod(name, a, b, radius, mat, bone, radius2=None, vertices=12):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
        radius2=radius if radius2 is None else radius2, depth=(b-a).length, location=(a+b)/2)
    obj = bpy.context.object
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return finish(obj, name, mat, bone)

def curve(name, points, radius, mat, bone):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 2
    data.bevel_depth = radius
    data.bevel_resolution = 2
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for p, co in zip(spline.bezier_points, points):
        p.co = co
        p.handle_left_type = p.handle_right_type = 'AUTO'
    if 'crest' in name or 'Beard' in name or 'tassel' in name:
        for i, p in enumerate(spline.bezier_points):
            p.radius = 1 - .88 * i / max(1, len(points)-1)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return finish(bpy.context.object, name, mat, bone)

def mesh(name, vertices, faces, mat, bone):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return finish(obj, name, mat, bone)

print('YANLIANG: sculpting layered armour and anatomy', flush=True)
# Blender Z up, facing -Y (glTF +Z). Feet at zero. Hero body height ~2.1 m.
ell('Padded cuirass', (0, 0, 1.43), (.34, .2, .35), CLOTH, 'chest')
ell('Waist coat', (0, .01, 1.12), (.27, .175, .21), RED, 'hips')
ell('Neck', (0, 0, 1.77), (.095, .085, .15), SKIN, 'neck')

# Articulated lamellar cuirass: each plate and rivet catches the studio light.
for row in range(6):
    z = 1.24 + row * .071
    width = .265 + .03 * math.sin(row / 5 * math.pi)
    for col in range(9):
        angle = (col - 4) * .22
        x = math.sin(angle) * width
        y = -.174 * math.cos(angle) - .035
        plate = box('Cuirass lamella', (x, y, z), (.06, .027, .085), IRON, 'chest', .005)
        plate.rotation_euler.z = -angle
        for offset in [-.019, .019]:
            ell('Brass lacing rivet', (x+offset, y-.019, z+.024), (.005, .004, .005), EDGE, 'chest', 8, 6)
curve('Cuirass neckline', [(-.27, -.12, 1.69), (-.15, -.2, 1.70), (0, -.225, 1.65), (.15, -.2, 1.70), (.27, -.12, 1.69)], .015, EDGE, 'chest')
curve('Chest relief crest', [(-.12,-.24,1.53),(-.055,-.25,1.59),(0,-.255,1.55),(.055,-.25,1.59),(.12,-.24,1.53)], .01, EDGE, 'chest')
ell('Lion breast boss', (0,-.249,1.5), (.067,.025,.075), EDGE, 'chest')
for side in [-1,1]:
    ell('Lion eye', (side*.024,-.274,1.52), (.008,.005,.007), BLACK,'chest',12,8)
curve('Lion snout', [(-.025,-.281,1.48),(0,-.286,1.497),(.025,-.281,1.48)], .01, IRON,'chest')
box('Wide leather war belt', (0,-.018,1.155), (.57,.36,.1), LEATHER,'hips')
box('Engraved belt clasp', (0,-.21,1.155), (.11,.03,.095), EDGE,'hips')
box('Clasp inset', (0,-.23,1.155), (.065,.014,.055), IRON,'hips',.008)

# Split armoured skirt allows the hips and knees to move independently.
for side in [-1,1]:
    tag = 'L' if side > 0 else 'R'
    thigh = 'thigh.'+tag
    for row in range(4):
        for col in range(4):
            x = side*(.06+col*.061)
            plate = box('Tasset lamella', (x,-.16-row*.01,1.04-row*.075), (.065,.025,.09), IRON, thigh,.004)
            plate.rotation_euler.y = side*.07
            ell('Tasset rivet', (x,-.18-row*.01,1.063-row*.075),(.006,.004,.006),EDGE,thigh,8,6)
    ell('Quilted thigh', (side*.155,.018,.87),(.125,.12,.26),CLOTH,thigh)
    ell('Knee joint', (side*.155,-.02,.62),(.105,.095,.10),LEATHER,'shin.'+tag)
    ell('Brass edged knee plate', (side*.155,-.098,.63),(.10,.044,.11),EDGE,'shin.'+tag)
    ell('Steel knee plate', (side*.155,-.125,.64),(.078,.022,.082),IRON,'shin.'+tag)
    rod('Greave core',(side*.155,0,.19),(side*.155,-.015,.56),.076,LEATHER,'shin.'+tag,.087)
    box('Steel shin guard',(side*.155,-.072,.37),(.115,.05,.34),IRON,'shin.'+tag,.026)
    for height in [.24,.47]:
        box('Greave strap',(side*.155,-.019,height),(.16,.165,.025),EDGE,'shin.'+tag,.007)
    ell('Leather boot',(side*.155,-.083,.10),(.093,.178,.095),LEATHER,'foot.'+tag)
    box('Boot sole',(side*.155,-.083,.026),(.18,.32,.045),BLACK,'foot.'+tag,.016)
    ell('Toe armour',(side*.155,-.20,.085),(.089,.085,.046),IRON,'foot.'+tag)

# Arms and overlapping shoulder plates, independently weighted gauntlets and fingers.
for side in [-1,1]:
    tag = 'L' if side > 0 else 'R'
    upper, fore, hand = 'upper_arm.'+tag, 'forearm.'+tag, 'hand.'+tag
    shoulder=(side*.365,0,1.63); elbow=(side*.47,-.02,1.36); wrist=(side*.53,-.14,1.14)
    rod('Upper arm sleeve',elbow,shoulder,.093,CLOTH,upper,.12)
    ell('Elbow articulation',elbow,(.09,.085,.085),LEATHER,fore)
    rod('Bracer',wrist,elbow,.071,IRON,fore,.085)
    for t in [.17,.84]:
        p=Vector(wrist).lerp(Vector(elbow),t)
        rod('Bracer brass cuff',p-Vector((0,0,.016)),p+Vector((0,0,.016)),.081,EDGE,fore)
    for row in range(3):
        p=ell('Layered shoulder armour',(side*(.33+row*.047),.003,1.66-row*.06),(.16,.17,.065),IRON,upper)
        p.rotation_euler.y=side*.28
        curve('Shoulder gold piping',[(side*(.24+row*.047),-.13,1.69-row*.06),(side*(.34+row*.047),-.17,1.67-row*.06),(side*(.45+row*.047),-.11,1.62-row*.06)],.008,EDGE,upper)
    ell('Hand', (side*.54,-.15,1.09),(.062,.049,.079),SKIN,hand)
    box('Gauntlet back',(side*.54,-.11,1.11),(.105,.03,.12),IRON,hand,.014)
    for finger in range(4):
        x=side*.54+(finger-1.5)*.025
        rod('Curled finger',(x,-.18,1.115),(x,-.20,1.06),.012,SKIN,hand)
    ell('Thumb',(side*.49,-.176,1.105),(.022,.028,.034),SKIN,hand,12,8)

# Face: brows, recessed eyes, cheek planes, nose, moustache and tapered beard.
ell('Head sculpt',(0,-.007,1.887),(.127,.107,.166),SKIN,'head',32,20)
ell('Strong jaw',(0,-.045,1.805),(.098,.087,.074),SKIN,'head')
for side in [-1,1]:
    ell('Ear',(side*.126,.005,1.88),(.025,.022,.047),SKIN,'head',16,10)
    ell('Cheekbone',(side*.073,-.082,1.85),(.038,.018,.031),SKIN,'head')
    ell('Eye socket',(side*.047,-.098,1.909),(.032,.009,.016),HAIR,'head')
    ell('Eye white',(side*.047,-.108,1.91),(.022,.006,.007),EYE,'head')
    ell('Iris',(side*.046,-.114,1.91),(.007,.003,.007),BLACK,'head',12,8)
    curve('Angled brow',[(side*.02,-.118,1.938),(side*.05,-.116,1.94),(side*.083,-.102,1.955)],.013,HAIR,'head')
ell('Nose bridge',(0,-.112,1.885),(.023,.026,.053),SKIN,'head')
ell('Nose tip',(0,-.139,1.863),(.031,.022,.022),SKIN,'head')
for side in [-1,1]:
    curve('Swept moustache',[(0,-.128,1.831),(side*.028,-.137,1.828),(side*.06,-.116,1.807)],.013,HAIR,'head')
curve('Lower lip',[(-.029,-.119,1.804),(0,-.128,1.8),(.029,-.119,1.804)],.006,SKIN,'head')
for i in range(9):
    x=(i-4)*.013
    curve('Beard lock',[(x,-.099,1.789),(x*.83,-.111,1.741),(x*.45,-.078,1.68+abs(i-4)*.009)],.012,HAIR,'head')

# Helmet dome with a cut-away face, brass seams and a sweeping crimson crest.
vertices=[]; faces=[]
for row in range(9):
    phi=.06+row/8*1.5
    for col in range(32):
        a=col/32*math.tau
        vertices.append((.15*math.sin(phi)*math.cos(a), .015+.132*math.sin(phi)*math.sin(a),1.956+.16*math.cos(phi)))
for row in range(8):
    for col in range(32):
        a=row*32+col; b=row*32+(col+1)%32
        faces.append((a,b,b+32,a+32))
mesh('Forged helmet dome',vertices,faces,IRON,'head')
curve('Helmet brow band',[(-.145,-.025,1.963),(-.1,-.108,1.966),(0,-.131,1.985),(.1,-.108,1.966),(.145,-.025,1.963)],.012,EDGE,'head')
curve('Helmet central rib',[(0,-.128,1.99),(0,-.07,2.105),(0,.015,2.12),(0,.125,2.035)],.011,EDGE,'head')
for side in [-1,1]:
    plate=box('Cheek guard',(side*.12,-.005,1.85),(.038,.13,.20),IRON,'head',.018)
    plate.rotation_euler.y=side*-.15
    for row in range(3):
        box('Helmet neck lames',(side*.105,.1,1.92-row*.046),(.083,.058,.052),IRON,'head',.01)
    ell('Temple boss',(side*.145,-.026,1.94),(.015,.036,.036),EDGE,'head')
rod('Crest socket',(0,.025,2.11),(0,.035,2.19),.026,EDGE,'head',.019)
for i in range(13):
    x=(i-6)*.006
    curve('Horsehair crimson crest',[(x,.035,2.175),(x*1.8,.02,2.30+abs(i-6)*.007),(x*2,.16,2.34),(x*2,.32,2.21),(x*2,.4,2.09-abs(i-6)*.01)],.009 if i%2 else .012,RED,'head')

# Cloak is a continuous mesh with a three-joint weighted chain, folds and brass border.
verts=[]; faces=[]
cols,rows=16,16
for row in range(rows+1):
    t=row/rows
    for col in range(cols+1):
        u=col/cols*2-1
        verts.append((u*(.27+.13*t),.17+.21*t+.035*math.cos(u*math.pi*5)*t,1.66-1.02*t+.06*u*u))
for row in range(rows):
    for col in range(cols):
        a=row*(cols+1)+col
        faces.append((a,a+1,a+cols+2,a+cols+1))
cape=mesh('Weighted crimson war cloak',verts,faces,RED,None)
for name in ['cape.01','cape.02','cape.03']: cape.vertex_groups.new(name=name)
for index, vertex in enumerate(cape.data.vertices):
    t=(1.66-vertex.co.z)/1.02*2
    low=max(0,min(2,int(t))); high=min(2,low+1); blend=max(0,min(1,t-low))
    cape.vertex_groups[low].add([index],1-blend if low!=high else 1,'REPLACE')
    if high!=low: cape.vertex_groups[high].add([index],blend,'REPLACE')
solid=cape.modifiers.new('Tailored cloth thickness','SOLIDIFY'); solid.thickness=.007
bpy.context.view_layer.objects.active=cape
bpy.ops.object.modifier_apply(modifier=solid.name)
for side in [-1,1]:
    ell('Cloak clasp',(side*.22,-.11,1.69),(.032,.018,.032),EDGE,'chest')

# Heavy dao: rigidly attached to the right hand, with a swept cutting edge and engraved spine.
wx,wy=-.54,-.19
rod('Hardwood glaive shaft',(wx,wy,.36),(wx,wy,2.12),.019,LEATHER,'hand.R',vertices=16)
for z in [.38,.54,.94,1.02,1.1,1.18,1.26,1.91,2.02]:
    rod('Glaive brass ferrule',(wx,wy,z),(wx,wy,z+.022),.024,EDGE,'hand.R',vertices=16)
outline=[(0,1.94),(-.07,2.07),(-.11,2.28),(-.27,2.47),(-.08,2.43),(.065,2.31),(.10,2.15),(.045,2.0)]
bladeverts=[(wx+x,wy+depth,z) for depth in [-.014,.014] for x,z in outline]
n=len(outline); bladefaces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]
bladefaces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
mesh('Swept dao steel blade',bladeverts,bladefaces,SILVER,'hand.R')
curve('Gold blade spine',[(wx-.015,wy-.016,2.02),(wx-.01,wy-.018,2.23),(wx-.1,wy-.018,2.40)],.009,EDGE,'hand.R')
curve('Blade etched wave',[(wx+.035,wy-.017,2.10),(wx+.03,wy-.018,2.19),(wx-.04,wy-.018,2.29)],.003,IRON,'hand.R')
for i in range(5):
    curve('Red weapon tassel',[(wx,wy,1.96),(wx+.04+i*.007,wy+.03,1.83),(wx+.025+i*.013,wy+.02,1.72)],.007,RED,'hand.R')

print('YANLIANG: building deform skeleton', flush=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.object.armature_add()
rig=bpy.context.object; rig.name='YanLiang_Rig'
bpy.ops.object.mode_set(mode='EDIT')
rig.data.edit_bones.remove(rig.data.edit_bones[0])
def bone(name,head,tail,parent=None):
    b=rig.data.edit_bones.new(name); b.head=head; b.tail=tail
    if parent: b.parent=rig.data.edit_bones[parent]
bone('root',(0,0,0),(0,0,.2))
bone('hips',(0,0,1.08),(0,0,1.25),'root')
bone('spine',(0,0,1.25),(0,0,1.43),'hips')
bone('chest',(0,0,1.43),(0,0,1.7),'spine')
bone('neck',(0,0,1.7),(0,0,1.79),'chest')
bone('head',(0,0,1.79),(0,0,2.09),'neck')
for side in [-1,1]:
    tag='L' if side>0 else 'R'
    bone('thigh.'+tag,(side*.155,0,1.08),(side*.155,-.02,.62),'hips')
    bone('shin.'+tag,(side*.155,-.02,.62),(side*.155,0,.16),'thigh.'+tag)
    bone('foot.'+tag,(side*.155,0,.16),(side*.155,-.22,.08),'shin.'+tag)
    bone('upper_arm.'+tag,(side*.365,0,1.63),(side*.47,-.02,1.36),'chest')
    bone('forearm.'+tag,(side*.47,-.02,1.36),(side*.53,-.14,1.14),'upper_arm.'+tag)
    bone('hand.'+tag,(side*.53,-.14,1.14),(side*.54,-.16,1.04),'forearm.'+tag)
bone('cape.01',(0,.16,1.66),(0,.24,1.32),'chest')
bone('cape.02',(0,.24,1.32),(0,.31,.98),'cape.01')
bone('cape.03',(0,.31,.98),(0,.38,.64),'cape.02')
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
for obj in parts: obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.join()
character=bpy.context.object; character.name='YanLiang_Armoured_General'
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
modifier=character.modifiers.new('Yan Liang weighted deformation','ARMATURE'); modifier.object=rig
character.parent=rig
rig.show_in_front=True
for pb in rig.pose.bones: pb.rotation_mode='XYZ'
foot_groups={character.vertex_groups[name].index for name in ['foot.L','foot.R']}
foot_vertices=[v.index for v in character.data.vertices if any(g.group in foot_groups for g in v.groups)]

def reset():
    for pb in rig.pose.bones:
        pb.rotation_euler=(0,0,0); pb.location=(0,0,0); pb.scale=(1,1,1)

def rot(name,x=0,y=0,z=0): rig.pose.bones[name].rotation_euler=(x,y,z)

def make_action(name,length,pose):
    rig.animation_data_create()
    action=bpy.data.actions.new(name); action.use_fake_user=True
    rig.animation_data.action=action
    for f in range(length+1):
        reset(); pose(f/length)
        if name == 'walk':
            bpy.context.view_layer.update()
            evaluated=character.evaluated_get(bpy.context.evaluated_depsgraph_get())
            lowest=min((evaluated.matrix_world @ evaluated.data.vertices[i].co).z for i in foot_vertices)
            rig.pose.bones['hips'].location.y-=lowest
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_euler',frame=f)
            pb.keyframe_insert('location',frame=f)
    return action

def idle(t):
    a=math.sin(t*math.tau)
    rot('chest',.009*a); rot('head',0,.012*a,0)
    rot('upper_arm.L',.025*a); rot('forearm.R',.012*a)
    for i in range(1,4): rot('cape.0'+str(i),.025*math.sin(t*math.tau-i*.5))

def walk(t):
    a=t*math.tau
    for side,phase in [('L',0),('R',math.pi)]:
        s=math.sin(a+phase)
        rot('thigh.'+side,.30*s)
        rot('shin.'+side,-.48*max(0,-s))
        rot('foot.'+side,.12*s+.18*max(0,-s))
    rig.pose.bones['hips'].location.y=.018*math.cos(a*2)
    rot('hips',0,.025*math.sin(a),.015*math.sin(a))
    rot('chest',0,-.03*math.sin(a),0)
    rot('upper_arm.L',-.24*math.sin(a)); rot('forearm.L',-.08-.08*math.cos(a))
    rot('upper_arm.R',.045*math.sin(a)); rot('forearm.R',-.035*math.sin(a))
    for i in range(1,4): rot('cape.0'+str(i),.055*math.sin(a-i*.7),0,.025*math.sin(a-i*.5))

def interp(t,keys):
    for i in range(len(keys)-1):
        if t<=keys[i+1][0]:
            u=(t-keys[i][0])/(keys[i+1][0]-keys[i][0]); u=max(0,min(1,u)); u=u*u*(3-2*u)
            return keys[i][1]*(1-u)+keys[i+1][1]*u
    return keys[-1][1]

def attack(t):
    # 0.75 s clip; strike lands at 0.53 of the cycle, matching castleAttackImpactAt.
    lift=interp(t,[(0,0),(.25,1),(.36,1),(.53,-.5),(.65,-.55),(1,0)])
    turn=interp(t,[(0,0),(.3,-.24),(.36,-.24),(.53,.32),(.7,.2),(1,0)])
    rot('upper_arm.R',-1.7*lift,0,-.20*lift)
    rot('forearm.R',-.5*max(0,lift),0,.12*lift)
    rot('hand.R',-.15*lift)
    rot('chest',-.12*max(0,-lift),turn,0)
    rot('hips',0,turn*.3,0)
    rot('upper_arm.L',-.55*lift,0,.12*lift)
    rot('forearm.L',-.35*max(0,lift))
    rot('head',.06*lift,-turn*.3,0)
    for i in range(1,4): rot('cape.0'+str(i),.09*math.sin(t*math.tau-i*.5),0,-turn*.35)
    # Keep the blade above the hand while winding up, then cut forward at impact.
    # Solve wrist orientation in world space so raising the elbow cannot invert the weapon.
    bpy.context.view_layer.update()
    pb=rig.pose.bones['hand.R']
    relative=pb.parent.bone.matrix_local.inverted() @ pb.bone.matrix_local
    base=pb.parent.matrix.to_3x3() @ relative.to_3x3()
    angle=interp(t,[(0,0),(.28,-.35),(.36,-.35),(.53,1.5),(.7,1.65),(1,0)])
    desired=Euler((angle,0,turn*.4)).to_matrix() @ pb.bone.matrix_local.to_3x3()
    pb.rotation_euler=(base.inverted() @ desired).to_euler('XYZ')

def die(t):
    s=t*t*(3-2*t)
    rot('root',0,0,1.38*s)
    rig.pose.bones['root'].location.z=-.06*s
    rot('thigh.L',-.55*s); rot('shin.L',-.8*s)
    rot('upper_arm.R',.8*s); rot('forearm.R',-.5*s)
    rot('head',.25*s)

actions={name:make_action(name,frames,fn) for name,frames,fn in [('idle',144,idle),('walk',60,walk),('attack',45,attack),('die',21,die)]}
rig.animation_data.action=actions['idle']; scene.frame_set(0)
print('YANLIANG: exporting rigged GLB with four actions',flush=True)
bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); character.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/assets/models/yanliang.glb'),export_format='GLB',
    use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_skins=True,
    export_anim_slide_to_zero=True,export_frame_range=False,export_force_sampling=True)

# Presentation scene is excluded from the game export.
studio=material('Studio charcoal',(.025,.035,.049),.15,.48)
bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=1.02,depth=.12,location=(0,0,-.065))
plinth=bpy.context.object; plinth.name='Display plinth'; plinth.data.materials.append(studio)
bevel=plinth.modifiers.new('Soft plinth rim','BEVEL'); bevel.width=.035; bevel.segments=3
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.132)); bpy.context.object.data.materials.append(studio)
world=bpy.data.worlds.new('Dark atelier') if not scene.world else scene.world
scene.world=world; world.use_nodes=True; world.node_tree.nodes['Background'].inputs[0].default_value=(.055,.075,.12,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35
def light(name,loc,power,color,size):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.color=color; data.shape='DISK'; data.size=size
    obj=bpy.data.objects.new(name,data); scene.collection.objects.link(obj); obj.location=loc
    obj.rotation_euler=(Vector((0,0,1.2))-obj.location).to_track_quat('-Z','Y').to_euler()
light('Warm key',(-3,-4,5),650,(1,.78,.56),4)
light('Cool fill',(3,-2,3),450,(.5,.7,1),3)
light('Cloak rim',(1,3,4),900,(1,.3,.16),3)
light('Helmet strip',(-2,1,5),600,(.65,.8,1),2)
bpy.ops.object.camera_add(location=(3.5,-6,3.0))
camera=bpy.context.object; camera.name='Portrait camera'
camera.rotation_euler=(Vector((-.06,0,1.2))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'; camera.data.ortho_scale=3.05; scene.camera=camera
scene.render.engine='CYCLES'; scene.cycles.samples=32; scene.cycles.use_denoising=True
scene.render.resolution_x=1000; scene.render.resolution_y=1200; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.view_settings.view_transform='AgX'
scene.frame_start=0; scene.frame_end=144
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'YanLiang.blend'))
report={'vertices':len(character.data.vertices),'triangles':sum(len(p.vertices)-2 for p in character.data.polygons),
        'bones':len(rig.data.bones),'materials':len(character.data.materials),'actions':{n:a.frame_range[:].to_list() if hasattr(a.frame_range[:],'to_list') else list(a.frame_range) for n,a in actions.items()}}
(OUT/'model_report.json').write_text(json.dumps(report,indent=2))
print('YANLIANG_REPORT',json.dumps(report),flush=True)
scene.render.filepath=str(OUT/'yanliang_portrait.png'); bpy.ops.render.render(write_still=True)
camera.location=(-3,-5,2.7); camera.rotation_euler=(Vector((-.1,0,1.23))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.ortho_scale=3.9
rig.animation_data.action=actions['attack']; scene.frame_set(13)
scene.render.filepath=str(OUT/'yanliang_attack.png'); bpy.ops.render.render(write_still=True)
print('YANLIANG: complete',flush=True)
