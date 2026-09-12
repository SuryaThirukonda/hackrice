extends RefCounted
## Rules and fixed-step lane simulation, independent of rendering and sockets.
var rolls := [[], []]
var player := 0
var standing := 10
var pins: Array[Dictionary] = []
var ball := Vector2.ZERO
var velocity := Vector2.ZERO
var hook := 0.0
var rolling := false
var gutter := false
var elapsed := 0.0
var result := "Aim, then roll"
var finished := false

func _init() -> void:
	reset_rack()

static func frames(values: Array) -> Array:
	var output: Array = []
	var cursor := 0
	for frame in range(10):
		if cursor >= values.size(): break
		var count := 1 if values[cursor]==10 and frame<9 else 2
		if frame==9 and cursor+1<values.size() and values[cursor]+values[cursor+1]>=10: count=3
		output.append(values.slice(cursor,mini(cursor+count,values.size())))
		cursor += count
	return output

static func complete(values: Array) -> bool:
	var parsed := frames(values)
	if parsed.size()!=10: return false
	var last: Array = parsed[9]
	return last.size()>=2 and (last[0]+last[1]<10 or last.size()==3)

static func score(values: Array) -> int:
	var total := 0
	var cursor := 0
	for frame in range(10):
		if cursor>=values.size(): break
		if frame==9:
			for value in values.slice(cursor): total+=int(value)
			break
		if values[cursor]==10:
			if cursor+2>=values.size(): break # Unresolved bonus is not a final frame score.
			total+=10+int(values[cursor+1])+int(values[cursor+2])
			cursor+=1
		else:
			if cursor+1>=values.size(): break
			var pair: int = values[cursor]+values[cursor+1]
			if pair==10:
				if cursor+2>=values.size(): break
				total+=10+int(values[cursor+2])
			else: total+=pair
			cursor+=2
	return total

func reset_rack() -> void:
	pins.clear()
	standing=10
	for row in range(4):
		for col in range(row+1):
			pins.append({"pos":Vector2((col-row*0.5)*0.6,-17-row*0.65),"vel":Vector2.ZERO,"down":false})

func launch(power: float, angle: float, position: float, spin: float) -> bool:
	if rolling or finished: return false
	ball=Vector2(clampf(position,-1.65,1.65),5)
	velocity=Vector2(sin(angle),-cos(angle))*lerpf(7,16,clampf(power/100,0,1))
	hook=clampf(spin,-1,1)
	rolling=true
	gutter=false
	elapsed=0
	return true

func step(dt: float) -> bool:
	if not rolling: return false
	elapsed+=dt
	if not gutter:
		velocity.x+=hook*0.4*dt if ball.y<-5 else hook*0.06*dt
	ball+=velocity*dt
	if absf(ball.x)>1.95:
		gutter=true
		ball.x=signf(ball.x)*2.2
		velocity.x=0
	for pin in pins:
		if not gutter and ball.distance_to(pin.pos)<0.47 and velocity.length()>1:
			pin.vel+=velocity*0.7
			pin.down=true
			velocity*=0.83
	for i in range(pins.size()):
		for j in range(i+1,pins.size()):
			var a: Dictionary = pins[i]
			var b: Dictionary = pins[j]
			var offset: Vector2 = b.pos-a.pos
			if offset.length()>0.001 and offset.length()<0.43:
				var normal := offset.normalized()
				var impulse: float = (a.vel-b.vel).dot(normal)
				if impulse>0:
					a.vel-=normal*impulse*0.65
					b.vel+=normal*impulse*0.85
					if impulse>0.8: a.down=true; b.down=true
	for pin in pins:
		pin.pos+=pin.vel*dt
		pin.vel=pin.vel.move_toward(Vector2.ZERO,dt*2.2)
	if elapsed>6 or (ball.y<-22 and elapsed>3):
		rolling=false
		var remaining := 0
		for pin in pins:
			if not pin.down: remaining+=1
		finish_roll(standing-remaining)
		return true
	return false

func finish_roll(knocked: int) -> void:
	knocked=clampi(knocked,0,standing)
	rolls[player].append(knocked)
	standing-=knocked
	var played := frames(rolls[player])
	var current: Array = played.back()
	result="STRIKE!" if knocked==10 else "SPARE!" if standing==0 else "%d pins" % knocked
	var end_turn: bool = current.size()==2 or current[0]==10
	if played.size()==10: end_turn=complete(rolls[player])
	if end_turn:
		player=1-player
		finished=complete(rolls[0]) and complete(rolls[1])
		reset_rack()
	elif standing==0:
		reset_rack() # Tenth-frame bonus rack.
	else:
		pins=pins.filter(func(pin: Dictionary): return not pin.down)
		for pin in pins: pin.vel=Vector2.ZERO
