extends RefCounted
## Three-hole arcade golf: persistent lies, flight/roll, hazards and stroke play.
const HOLES := [
	{"name":"Meadow Bend","par":3,"cup":Vector2(1,-15),"water":Rect2(-3.3,-8,2.1,3),"sand":Rect2(1,-5,2.2,3)},
	{"name":"Island Approach","par":4,"cup":Vector2(-1.7,-17),"water":Rect2(-3.3,-10,4.2,3),"sand":Rect2(1,-16,2,4)},
	{"name":"Sandbank Finish","par":3,"cup":Vector2(0,-16),"water":Rect2(1,-6,2.3,4),"sand":Rect2(-3.3,-13,4.5,3)},
]
const CLUBS := ["Putter","Wedge","Iron"]
var hole := 0
var player := 0
var positions := [Vector2(0,5),Vector2(0,5)]
var strokes := [0,0]
var totals := [0,0]
var cards := [[],[]]
var holed := [false,false]
var velocity := Vector2.ZERO
var height := 0.0
var vertical := 0.0
var rolling := false
var finished := false
var elapsed := 0.0
var previous_lie := Vector2.ZERO
var result := "Hole 1 · Meadow Bend"

func launch(power: float, angle: float, club: int) -> bool:
	if rolling or finished or holed[player]: return false
	club=clampi(club,0,2)
	previous_lie=positions[player]
	strokes[player]+=1
	var speed: float = [7.5,9.0,12.0][club]*clampf(power/100.0,0.04,1)
	velocity=Vector2(sin(angle),-cos(angle))*speed
	height=0
	vertical=([0.0,5.0,3.2][club])*clampf(power/100.0,0.04,1)
	rolling=true
	elapsed=0
	return true

func step(dt: float) -> bool:
	if not rolling: return false
	elapsed+=dt
	var at: Vector2 = positions[player]
	at+=velocity*dt
	if height>0 or vertical>0:
		height+=vertical*dt
		vertical-=9.8*dt
		if height<=0:
			height=0
			vertical=absf(vertical)*0.25 if absf(vertical)>1.5 else 0.0
			velocity*=0.75
	else:
		var friction := 3.5 if HOLES[hole].sand.has_point(at) else 0.65
		velocity=velocity.move_toward(Vector2.ZERO,dt*friction)
	positions[player]=at
	if absf(at.x)>3.35 or at.y<-19 or at.y>7:
		penalty("Out of bounds · +1 penalty")
		return true
	if height<0.08 and HOLES[hole].water.has_point(at):
		penalty("Water hazard · +1 penalty")
		return true
	if height<0.08 and at.distance_to(HOLES[hole].cup)<0.38 and velocity.length()<2.5:
		positions[player]=HOLES[hole].cup
		holed[player]=true
		result="HOLED! %d strokes (%+d)" % [strokes[player],strokes[player]-HOLES[hole].par]
		end_shot()
		return true
	if (velocity.length()<0.06 and height==0 and vertical==0) or elapsed>14:
		result="%.1fm to cup" % at.distance_to(HOLES[hole].cup)
		end_shot()
		return true
	return false

func penalty(message: String) -> void:
	strokes[player]+=1
	positions[player]=previous_lie
	result=message
	end_shot()

func end_shot() -> void:
	rolling=false
	velocity=Vector2.ZERO
	height=0
	vertical=0
	if strokes[player]>=10:
		holed[player]=true
		result+=" · stroke limit"
	if holed[0] and holed[1]:
		for p in [0,1]:
			totals[p]+=strokes[p]
			cards[p].append(strokes[p])
		hole+=1
		if hole==HOLES.size():
			finished=true
			return
		positions=[Vector2(0,5),Vector2(0,5)]
		strokes=[0,0]
		holed=[false,false]
		player=0
		result+=" · next hole"
	elif not holed[1-player]: player=1-player

func bot_shot() -> Dictionary:
	var offset: Vector2 = HOLES[hole].cup-positions[player]
	var distance := offset.length()
	var club := 0 if distance<5 else 2
	# Roll distance v²/(2*friction); iron also carries in the air.
	var speed := sqrt(2*0.65*distance)
	var power := clampf(speed/(7.5 if club==0 else 11.0)*100,8,100)
	return {"angle":atan2(offset.x,-offset.y),"power":power,"club":club}
