extends Node
const Bowl = preload("res://scripts/bowling_match.gd")
const Golf = preload("res://scripts/golf_match.gd")
const Fight = preload("res://scripts/boxing_match.gd")
var failures := 0
var checks := 0
func check(ok: bool, label: String) -> void:
	checks+=1
	if not ok:
		failures+=1
		push_error(label)

func _ready() -> void:
	check(Bowl.score([10,10,10,10,10,10,10,10,10,10,10,10])==300,"Perfect game scores 300")
	check(Bowl.score([5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5])==150,"All spares score 150")
	check(Bowl.score([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])==0,"Gutter game scores 0")
	check(Bowl.score([10,3,4])==24,"Strike bonus carries")
	check(Bowl.score([7,3,4,2])==20,"Spare bonus carries")
	check(not Bowl.complete([10,10,10,10,10,10,10,10,10,10,10]),"Tenth requires third bonus")
	var bowl = Bowl.new()
	for i in range(24): bowl.finish_roll(10)
	check(bowl.finished,"Both perfect games finish")
	check(Bowl.score(bowl.rolls[0])==300 and Bowl.score(bowl.rolls[1])==300,"Both players retain scores")
	bowl=Bowl.new()
	for i in range(40): bowl.finish_roll(0)
	check(bowl.finished,"Two gutter games finish")
	bowl=Bowl.new()
	bowl.finish_roll(4)
	check(bowl.player==0 and bowl.standing==6,"First roll retains rack and player")
	bowl.finish_roll(6)
	check(bowl.player==1 and bowl.standing==10,"Spare switches and resets rack")
	bowl=Bowl.new()
	bowl.launch(100,0.7,1.5,1)
	for tick in range(800): bowl.step(1.0/120)
	check(not bowl.rolling and bowl.rolls[0][0]==0,"Gutter cannot knock pins")
	var a = Bowl.new()
	var b = Bowl.new()
	a.launch(75,0,0,0.1); b.launch(75,0,0,0.1)
	for tick in range(800): a.step(1.0/120); b.step(1.0/120)
	check(a.rolls==b.rolls,"Bowling deterministic replay")
	check(a.rolls[0][0]>0,"Center roll hits pins")
	var golf = Golf.new()
	golf.positions[0]=Golf.HOLES[0].cup+Vector2(0,0.3)
	golf.launch(4,0,0)
	for tick in range(100): golf.step(1.0/120)
	check(golf.holed[0] and golf.strokes[0]==1,"Cup capture counts one stroke")
	golf=Golf.new()
	golf.positions[0]=Vector2(-2,-4.7)
	golf.launch(40,0,0)
	for tick in range(2000): golf.step(1.0/120)
	check(golf.strokes[0]==2 and golf.positions[0]==Vector2(-2,-4.7),"Water adds penalty and restores lie")
	golf=Golf.new()
	var iterations := 0
	while not golf.finished and iterations<200:
		var shot: Dictionary = golf.bot_shot()
		golf.launch(shot.power,shot.angle,shot.club)
		for tick in range(1800):
			if golf.step(1.0/120): break
		iterations+=1
	check(golf.finished,"Full golf course terminates")
	check(golf.cards[0].size()==3 and golf.cards[1].size()==3,"Both golf cards contain three holes")
	var fight = Fight.new()
	fight.start()
	fight.guard[1]=true
	fight.punch(0,100,1)
	check(is_equal_approx(fight.health[1],97.45),"Guard allows 15 percent damage")
	check(fight.stamina[0]<100 and fight.stamina[1]<100,"Punch and guard consume stamina")
	fight.step(0.3)
	fight.stamina[1]=1
	fight.punch(0,100,1)
	check(not fight.guard[1] and fight.stagger[1]>0,"Guard breaks when exhausted")
	fight=Fight.new(); fight.start()
	fight.punch(0,100,5)
	check(fight.health[1]==100,"Out of reach misses")
	fight=Fight.new(); fight.start()
	fight.health[1]=5
	fight.punch(0,100,1)
	check(fight.phase=="finished" and fight.winner==0,"KO ends match")
	fight=Fight.new(); fight.start()
	fight.health[1]=65
	fight.punch(0,100,1)
	check(fight.phase=="count","Threshold triggers knockdown")
	for tick in range(1201): fight.step(1.0/120)
	check(fight.phase=="fight","Count resumes fight")
	fight=Fight.new(); fight.start()
	for tick in range(35000): fight.step(1.0/120)
	check(fight.phase=="finished" and fight.round==3,"Three rounds end in decision")
	print("Match rules: %d checks, %d failures" % [checks,failures])
	get_tree().quit(1 if failures else 0)
