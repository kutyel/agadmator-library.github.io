import fs from "fs";
import path from 'path';
import {fileURLToPath} from 'url';
import _ from "lodash";
import {
    database,
    NAMESPACE_CHESS_COM,
    NAMESPACE_CHESSTEMPO_COM,
    NAMESPACE_VIDEO_GAME,
    NAMESPACE_VIDEO_SNIPPET
} from './db.js'
import {pgnRead} from 'kokopu'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resultDir = `${__dirname}/../generated`

function writeResultFile(fileName: string, object: any) {
    fs.writeFileSync(`${resultDir}/${fileName}`, JSON.stringify(object))
}

function getResult(id: string) {
    const chessComResult = database.read(NAMESPACE_CHESS_COM, id)
    const chesstempoComResult = database.read(NAMESPACE_CHESSTEMPO_COM, id)

    function translateChessComResult(text: string | undefined | null) {
        switch (text) {
            case "1-0":
                return 1
            case "0-1":
                return -1
            case "½-½":
                return 0
            default:
                return null
        }
    }

    function translateChesstempoComResult(text: string | undefined | null) {
        switch (text) {
            case "w":
                return 1
            case "b":
                return -1
            case "d":
                return 0
            default:
                return null
        }
    }

    return chessComResult && chessComResult.result
        ? translateChessComResult(chessComResult.result)
        : (chesstempoComResult ? translateChesstempoComResult(chesstempoComResult.result) : null)
}

function getYear(id: string): number | null | undefined {
    const game = database.read(NAMESPACE_VIDEO_GAME, id)
    if (!game.playerWhite) {
        return null
    }
    const chessComResult = database.read(NAMESPACE_CHESS_COM, id)
    const chesstempoComResult = database.read(NAMESPACE_CHESSTEMPO_COM, id)

    return chessComResult && chessComResult.year && chessComResult.year !== "0"
        ? parseInt(chessComResult.year)
        : (chesstempoComResult && chesstempoComResult.date ? parseInt(chesstempoComResult.date.substring(0, 4)) : null)
}

function removeNulls(obj: any): any {
    return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v != null));
}

type DB = {
    players: string[],
    videos: any[]
}

export function combine() {
    const db: DB = {
        players: [],
        videos: []
    }
    const pgns: any = {}
    const allPgns: string[] = []
    database.getAllIds().forEach((id: string) => {
        const videoSnippet = database.read(NAMESPACE_VIDEO_SNIPPET, id)
        if (!videoSnippet) {
            return
        }

        let game = database.read(NAMESPACE_VIDEO_GAME, id)
        if (!game) {
            game = null
        }

        let wId = null
        if (game && game.playerWhite) {
            wId = db.players.indexOf(game.playerWhite) >= 0 ? db.players.indexOf(game.playerWhite) : db.players.push(game.playerWhite) - 1
        }
        let bId = null
        if (game && game.playerBlack) {
            bId = db.players.indexOf(game.playerBlack) >= 0 ? db.players.indexOf(game.playerBlack) : db.players.push(game.playerBlack) - 1
        }

        db.videos.push(removeNulls({
            d: new Date(videoSnippet.publishedAt).getTime() / 1000,
            t: videoSnippet.title,
            id: videoSnippet.videoId,
            g: game ? removeNulls({w: wId, b: bId, r: getResult(id), y: getYear(id)}) : null
        }))

        if (game && game.pgn) {
            pgns[videoSnippet.videoId] = game.pgn
            allPgns.push(game.pgn)
        }

    })
    writeResultFile("db.json", db)
    writeResultFile("pgns.json", pgns)

    const positions: any = {
        videos: []
    }
    Object.keys(pgns).forEach(videoId => {
        const videoArrayId = positions.videos.push(videoId) - 1
        const pgn = pgns[videoId]
        pgnRead(pgn + " 1-0")
            .game(0)
            .mainVariation()
            .nodes()
            .slice(2, 14)
            .forEach(node => {
                const fen = node.position().fen().replaceAll(/ - \d+ \d+/g, "")
                if (!positions[fen]) {
                    positions[fen] = []
                }
                positions[fen].push(videoArrayId)
            })
    })
    writeResultFile("positions.json", positions)

    let openings = JSON.parse(fs.readFileSync(__dirname + '/../openings.json', {encoding: 'utf8'}))
        .filter((opening: any) => {
            return _.some(allPgns, videoPgn => _.startsWith(videoPgn, opening.pgn))
        })
        .map((opening: any) => {
            return {
                name: `${opening.eco} - ${opening.name}`,
                moves: opening.pgn
            }
        })
    writeResultFile("openings-slim.json", openings)

    const b4: string[] = []
    database.getAllIds().forEach((id: string) => {
        const game = database.read(NAMESPACE_VIDEO_GAME, id)
        if (!game || !game.pgn) {
            return
        }

        const b4Played = /\d\.\s+b4/.test(game.pgn)
        if (b4Played) {
            b4.push(id)
        }
    })
    writeResultFile("b4.json", b4)
}

combine();
