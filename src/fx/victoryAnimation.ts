import Phaser from 'phaser'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { sfx } from './sfx'
import { actionBurst } from '../ui/widgets'

export interface VictoryAnimationOpts {
  scene: Phaser.Scene
  winner: 'a' | 'b' | 'draw'
  is2p: boolean
  p1Name?: string
  p2Name?: string
  method?: string // 'ko' | 'decision' | 'draw' | 'score' | etc.
  sport?: 'boxing' | 'bowling' | 'golf'
  onComplete: () => void
}

/**
 * High-impact comic victory ending animation.
 * Features rotating sunburst rays, split-screen winner corner glow (in 2P),
 * celebratory confetti explosion, comic action bursts (POW/KO/CHAMP),
 * and a bold slamming winner banner.
 */
export function playVictoryAnimation(opts: VictoryAnimationOpts): { destroy: () => void } {
  const { scene: s, winner, is2p, onComplete } = opts
  const { width: W, height: H } = s.scale

  const p1Name = opts.p1Name ?? (is2p ? 'PLAYER 1' : 'YOU')
  const p2Name = opts.p2Name ?? (is2p ? 'PLAYER 2' : 'THE HOUSE')

  // Theme colors & copy based on winner & mode
  let headline = 'WINNER!'
  let subheader = ''
  let ribbonText = '★ VICTORY ★'
  let themeColor = P.green
  let bursts: [string, number][] = []

  if (is2p) {
    if (winner === 'a') {
      headline = `${p1Name.toUpperCase()} WINS!`
      ribbonText = '★ 2-PLAYER CHAMPION ★'
      subheader = opts.method === 'ko' ? 'KNOCKOUT VICTORY!' : 'DECISION VICTORY!'
      themeColor = P.blue
      bursts = [['POW!', P.blue], ['CHAMP!', P.gold], ['VICTORY!', P.blue], ['KO!', P.magenta]]
    } else if (winner === 'b') {
      headline = `${p2Name.toUpperCase()} WINS!`
      ribbonText = '★ 2-PLAYER CHAMPION ★'
      subheader = opts.method === 'ko' ? 'KNOCKOUT VICTORY!' : 'DECISION VICTORY!'
      themeColor = P.red
      bursts = [['BAM!', P.red], ['CHAMP!', P.gold], ['VICTORY!', P.red], ['KO!', P.magenta]]
    } else {
      headline = "IT'S A DRAW!"
      ribbonText = '★ STALEMATE ★'
      subheader = 'EVENLY MATCHED CONTENDERS!'
      themeColor = P.gold
      bursts = [['DRAW!', P.gold], ['TIED!', P.blue], ['EVEN!', P.paper]]
    }
  } else {
    // 1-Player (Player 1 vs AI / The House)
    if (winner === 'a') {
      headline = 'PLAYER 1 WINS!'
      ribbonText = '★ NEW CHAMPION! ★'
      subheader = opts.method === 'ko' ? 'KNOCKOUT! THE HOUSE IS DOWN!' : 'THE HOUSE HAS BEEN DEFEATED!'
      themeColor = P.green
      bursts = [['POW!', P.green], ['WINNER!', P.gold], ['KO!', P.magenta], ['CHAMP!', P.blue]]
    } else if (winner === 'b') {
      headline = 'THE HOUSE WINS!'
      ribbonText = '★ THE HOUSE RULES ★'
      subheader = 'BETTER LUCK NEXT TIME, CONTENDER!'
      themeColor = P.red
      bursts = [['DEFEAT!', P.red], ['OOF!', P.ink], ['THE HOUSE!', P.gold]]
    } else {
      headline = "IT'S A DRAW!"
      ribbonText = '★ STALEMATE ★'
      subheader = 'A DEAD HEAT AGAINST THE HOUSE!'
      themeColor = P.gold
      bursts = [['DRAW!', P.gold], ['TIED!', P.blue], ['EVEN!', P.paper]]
    }
  }

  const objects: Phaser.GameObjects.GameObject[] = []
  const timers: Phaser.Time.TimerEvent[] = []
  let completed = false

  const cleanup = () => {
    if (completed) return
    completed = true
    timers.forEach((t) => t.destroy())
    objects.forEach((o) => {
      try { o.destroy() } catch { /* noop */ }
    })
    s.input.off('pointerdown', skipHandler)
    if (s.input.keyboard) s.input.keyboard.off('keydown', skipHandler)
  }

  const finishAndProceed = () => {
    if (completed) return
    s.tweens.add({
      targets: objects.filter((o) => 'alpha' in o),
      alpha: 0,
      scale: 1.06,
      duration: 220,
      ease: 'Quad.In',
      onComplete: () => {
        cleanup()
        onComplete()
      },
    })
  }

  // 1. Dark vignette dimmer backdrop
  const dim = s.add.rectangle(0, 0, W, H, P.ink, 0.65).setOrigin(0).setDepth(200)
  dim.setInteractive() // intercept clicks
  objects.push(dim)

  // 2. Winner corner highlight (for 2-player split screen)
  if (is2p && (winner === 'a' || winner === 'b')) {
    const isP1 = winner === 'a'
    const x0 = isP1 ? 0 : W / 2
    const wHalf = W / 2

    const cornerGlow = s.add.graphics().setDepth(201)
    cornerGlow.fillStyle(themeColor, 0.16).fillRect(x0, 0, wHalf, H)
    cornerGlow.lineStyle(10, themeColor, 0.85).strokeRect(x0 + 5, 5, wHalf - 10, H - 10)
    objects.push(cornerGlow)

    // Corner badge
    const cornerLabel = s.add.text(isP1 ? W * 0.25 : W * 0.75, 42, `★ ${isP1 ? 'PLAYER 1' : 'PLAYER 2'} VICTORY ZONE ★`, {
      fontFamily: DISPLAY,
      fontSize: '22px',
      color: '#fff6e5',
      stroke: HEX(P.ink),
      strokeThickness: 6,
    }).setOrigin(0.5).setDepth(203)
    objects.push(cornerLabel)

    // Pulse animation
    s.tweens.add({
      targets: [cornerGlow, cornerLabel],
      alpha: 0.6,
      yoyo: true,
      repeat: -1,
      duration: 500,
      ease: 'Sine.InOut',
    })
  }

  // 3. Rotating sunburst rays
  const rays = s.add.graphics().setDepth(202).setPosition(W / 2, H * 0.44)
  const rayRadius = Math.max(W, H) * 1.2
  const numRays = 24
  for (let i = 0; i < numRays; i++) {
    if (i % 2 === 0) continue
    const a0 = (i / numRays) * Math.PI * 2
    const a1 = ((i + 1) / numRays) * Math.PI * 2
    rays.fillStyle(themeColor, 0.28).fillTriangle(
      0, 0,
      Math.cos(a0) * rayRadius, Math.sin(a0) * rayRadius,
      Math.cos(a1) * rayRadius, Math.sin(a1) * rayRadius
    )
  }
  objects.push(rays)

  // Rotate rays continuously
  s.tweens.add({
    targets: rays,
    angle: 360,
    duration: 16000,
    repeat: -1,
    ease: 'Linear',
  })

  // 4. Confetti particles explosion
  const confettiColors = [P.gold, P.red, P.blue, P.green, P.magenta, P.paper, P.cyan, P.orange]
  for (let i = 0; i < 65; i++) {
    const cg = s.add.graphics().setDepth(205)
    const color = confettiColors[i % confettiColors.length]
    cg.fillStyle(color, 1)
    if (i % 3 === 0) {
      // Little stars / diamonds
      cg.fillPoints([
        { x: 0, y: -7 }, { x: 5, y: 0 }, { x: 0, y: 7 }, { x: -5, y: 0 },
      ], true)
    } else {
      // Comic ticker ribbons
      cg.fillRect(-6, -4, 12, 8)
    }
    cg.lineStyle(1.5, P.ink, 0.8)
    cg.strokePath()

    const startX = W / 2 + Phaser.Math.Between(-80, 80)
    const startY = H * 0.44 + Phaser.Math.Between(-40, 40)
    cg.setPosition(startX, startY).setScale(0)

    const targetAngle = Phaser.Math.FloatBetween(0, Math.PI * 2)
    const speed = Phaser.Math.Between(180, 520)
    const targetX = startX + Math.cos(targetAngle) * speed
    const targetY = startY + Math.sin(targetAngle) * speed + Phaser.Math.Between(100, 320)

    s.tweens.add({
      targets: cg,
      x: targetX,
      y: targetY,
      scale: Phaser.Math.FloatBetween(0.8, 1.4),
      angle: Phaser.Math.Between(-360, 360),
      duration: Phaser.Math.Between(1200, 2400),
      ease: 'Cubic.Out',
      onComplete: () => {
        // Drift down
        s.tweens.add({
          targets: cg,
          y: targetY + 120,
          alpha: 0,
          duration: 900,
          ease: 'Sine.In',
        })
      },
    })
    objects.push(cg)
  }

  // 5. Center Comic Banner Container
  const bannerW = Math.min(760, W * 0.84)
  const bannerH = 260
  const banner = s.add.container(W / 2, H * 0.44).setDepth(210).setScale(0).setAngle(-2.5)
  objects.push(banner)

  // Banner Graphics: Comic drop shadow + panel + thick ink borders
  const bg = s.add.graphics()
  // Ink Drop shadow
  bg.fillStyle(P.ink, 0.95).fillRoundedRect(-bannerW / 2 + 12, -bannerH / 2 + 14, bannerW, bannerH, 28)
  // Paper panel
  bg.fillStyle(P.paper, 1).fillRoundedRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH, 28)
  // Inner colored accent stripe
  bg.fillStyle(themeColor, 0.18).fillRoundedRect(-bannerW / 2 + 10, -bannerH / 2 + 10, bannerW - 20, bannerH - 20, 20)
  // Outer thick ink border
  bg.lineStyle(8, P.ink, 1).strokeRoundedRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH, 28)
  // Inner thin border
  bg.lineStyle(3, P.ink, 0.6).strokeRoundedRect(-bannerW / 2 + 10, -bannerH / 2 + 10, bannerW - 20, bannerH - 20, 20)
  banner.add(bg)

  // Top Stamped Ribbon
  const ribbonG = s.add.graphics()
  const ribbonW = Math.min(420, bannerW * 0.68)
  const ribbonH = 44
  const ribbonY = -bannerH / 2 - 8
  ribbonG.fillStyle(P.ink, 0.9).fillRoundedRect(-ribbonW / 2 + 5, ribbonY + 6, ribbonW, ribbonH, 12)
  ribbonG.fillStyle(P.gold, 1).fillRoundedRect(-ribbonW / 2, ribbonY, ribbonW, ribbonH, 12)
  ribbonG.lineStyle(4, P.ink, 1).strokeRoundedRect(-ribbonW / 2, ribbonY, ribbonW, ribbonH, 12)
  banner.add(ribbonG)

  const ribbonLabel = s.add.text(0, ribbonY + ribbonH / 2, ribbonText, {
    fontFamily: DISPLAY,
    fontSize: '24px',
    color: HEX(P.ink),
    fontStyle: '900',
  }).setOrigin(0.5)
  banner.add(ribbonLabel)

  // Giant Headline Text
  const titleText = s.add.text(0, -14, headline, {
    fontFamily: DISPLAY,
    fontSize: bannerW < 600 ? '54px' : '72px',
    color: HEX(themeColor),
    stroke: HEX(P.ink),
    strokeThickness: 14,
    align: 'center',
  }).setOrigin(0.5)
  banner.add(titleText)

  // Subheader badge / method
  const subText = s.add.text(0, bannerH / 2 - 46, subheader, {
    fontFamily: FONT,
    fontSize: '20px',
    color: HEX(P.ink),
    fontStyle: '900',
    backgroundColor: HEX(P.paper),
    padding: { x: 14, y: 4 },
  }).setOrigin(0.5)
  banner.add(subText)

  // 6. Action Bursts around the banner
  const burstOffsets: [number, number][] = [
    [-bannerW * 0.46, -bannerH * 0.44],
    [bannerW * 0.46, -bannerH * 0.42],
    [-bannerW * 0.44, bannerH * 0.42],
    [bannerW * 0.45, bannerH * 0.44],
  ]

  bursts.slice(0, 4).forEach(([word, color], i) => {
    const [bx, by] = burstOffsets[i]
    const b = actionBurst(s, W / 2 + bx, H * 0.44 + by, word, color, 46)
      .setDepth(215)
      .setScale(0)
      .setAngle(Phaser.Math.Between(-16, 16))
    objects.push(b)

    s.tweens.add({
      targets: b,
      scale: 1.1,
      duration: 220,
      delay: 360 + i * 110,
      ease: 'Back.Out',
      onComplete: () => {
        s.tweens.add({
          targets: b,
          scale: 0.96,
          yoyo: true,
          repeat: -1,
          duration: 900,
          ease: 'Sine.InOut',
        })
      },
    })
  })

  // 7. Prompt text: "Press any key or click to view scorecard"
  const prompt = s.add.text(W / 2, H - 48, 'CLICK OR PRESS ANY KEY TO VIEW SCORECARD', {
    fontFamily: FONT,
    fontSize: '15px',
    color: '#fff6e5',
    fontStyle: '900',
    backgroundColor: HEX(P.ink),
    padding: { x: 14, y: 6 },
  }).setOrigin(0.5).setDepth(220).setAlpha(0)
  objects.push(prompt)

  s.tweens.add({
    targets: prompt,
    alpha: 1,
    duration: 300,
    delay: 1100,
    onComplete: () => {
      s.tweens.add({
        targets: prompt,
        alpha: 0.4,
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
    },
  })

  // 8. Sound Effects & Impact Slam Animation
  // Start with whoosh, then stamp down
  sfx.whoosh(true)

  s.tweens.add({
    targets: banner,
    scale: 1,
    duration: 320,
    ease: 'Back.Out',
    onComplete: () => {
      // Impact stamp
      sfx.stamp()
      if (winner === 'a' || (is2p && winner === 'b')) {
        sfx.win()
        sfx.crowd(0.6, 2.2)
      } else if (winner === 'b') {
        // AI wins
        sfx.thud(1.4)
        sfx.bell(1)
      } else {
        sfx.bell(2)
      }

      // Camera shake on impact
      s.cameras.main.shake(160, 0.007)

      // Floating breath tween on the banner
      s.tweens.add({
        targets: banner,
        y: H * 0.44 - 8,
        angle: -1.2,
        duration: 1400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
    },
  })

  // Secondary sparkle sound at 500ms
  timers.push(s.time.delayedCall(500, () => sfx.sparkle()))

  // 9. Input & Auto-advance handlers
  let allowSkip = false
  timers.push(s.time.delayedCall(850, () => { allowSkip = true }))

  const skipHandler = () => {
    if (!allowSkip || completed) return
    finishAndProceed()
  }

  s.input.on('pointerdown', skipHandler)
  if (s.input.keyboard) s.input.keyboard.on('keydown', skipHandler)

  // Auto-advance after 3.8 seconds if not skipped
  timers.push(s.time.delayedCall(3800, () => {
    if (!completed) finishAndProceed()
  }))

  return {
    destroy: () => cleanup(),
  }
}
