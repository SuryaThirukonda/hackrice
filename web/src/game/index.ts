import Phaser from 'phaser'
import { GameClient } from './client'
import { MenuScene } from './scenes/MenuScene'
import { BoxingScene } from './scenes/BoxingScene'

export interface GameHandle { game: Phaser.Game; client: GameClient; destroy(): void }

export function createGame(parent: HTMLElement, wsUrl?: string): GameHandle {
  const client = new GameClient(wsUrl)
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent, backgroundColor: '#0b1220', antialias: true,
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: 1280, height: 720 },
    scene: [MenuScene, BoxingScene],
    callbacks: { preBoot: (g) => { g.registry.set('client', client) } },
  })
  return { game, client, destroy: () => { client.socket.close(); game.destroy(true) } }
}
