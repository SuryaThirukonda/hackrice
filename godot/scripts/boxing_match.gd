extends RefCounted
var health := [100.0,100.0]
var stamina := [100.0,100.0]
var guard := [false,false]
var stagger := [0.0,0.0]
var cooldown := [0.0,0.0]
var damage := [0.0,0.0]
var knockdowns := [0,0]
var round_knockdowns := [0,0]
var round := 1
var remaining := 90.0
var phase := "ready"
var phase_time := 0.0
var down_player := -1
var message := "Referee: Ready? Start match"
var winner := -1

func start() -> void:
	phase="fight"
	message="Referee: Start!"

func step(dt: float) -> void:
	for p in [0,1]:
		cooldown[p]=maxf(0,cooldown[p]-dt)
		stagger[p]=maxf(0,stagger[p]-dt)
		stamina[p]=minf(100,stamina[p]+dt*(3 if guard[p] else 11))
		if stagger[p]>0: guard[p]=false
	if phase=="fight":
		remaining=maxf(0,remaining-dt)
		if remaining==0:
			if round==3:
				finish(0 if damage[0]>damage[1] else 1 if damage[1]>damage[0] else -1,"Decision")
			else:
				phase="break"
				phase_time=5
				guard=[false,false]
				message="Referee: Stop! Between rounds"
	elif phase=="break" or phase=="count":
		phase_time-=dt
		if phase=="count": message="Referee: %d… knockdown!" % clampi(11-ceili(phase_time),1,10)
		if phase_time<=0:
			if phase=="break":
				round+=1
				remaining=90
				round_knockdowns=[0,0]
				stamina=[100.0,100.0]
			phase="fight"
			message="Referee: Start!"

func punch(attacker: int, power: float, distance: float, momentum := 0.0) -> String:
	if phase!="fight" or cooldown[attacker]>0 or stagger[attacker]>0: return ""
	if guard[attacker]: return "Lower your guard to punch"
	var cost := lerpf(7,18,clampf(power/100,0,1))
	if stamina[attacker]<cost: return "Too tired · recover stamina"
	stamina[attacker]-=cost
	cooldown[attacker]=0.24
	if distance>2.25: return "Out of reach · step closer"
	var defender := 1-attacker
	var hit := lerpf(2,17,clampf(power/100,0,1))*(1+clampf(momentum,0,1)*0.5)
	var text := "Hit!"
	if guard[defender] and stagger[defender]<=0:
		stamina[defender]=maxf(0,stamina[defender]-hit*1.3)
		hit*=0.15
		text="Blocked"
		if stamina[defender]==0:
			guard[defender]=false
			stagger[defender]=1.5
			text="Guard break!"
	health[defender]=maxf(0,health[defender]-hit)
	damage[attacker]+=hit
	if health[defender]==0:
		finish(attacker,"KO")
	elif (knockdowns[defender]==0 and health[defender]<=60) or (knockdowns[defender]==1 and health[defender]<=30):
		knockdowns[defender]+=1
		round_knockdowns[defender]+=1
		if round_knockdowns[defender]>=3: finish(attacker,"TKO")
		else:
			phase="count"
			phase_time=10
			down_player=defender
			guard=[false,false]
			message="Knockdown! Referee counting"
	return text

func finish(player: int, reason: String) -> void:
	phase="finished"
	winner=player
	guard=[false,false]
	message="Draw" if player<0 else "%s · Controller %d wins!" % [reason,player+1]
