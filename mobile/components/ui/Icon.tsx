/**
 * Icon.tsx — Divine Bridge custom icon system
 *
 * Usage:
 *   <Icon name="home" size={18} color="#b07d20" />
 *   <Icon name="bell" size={16} />          // defaults to current text color via style
 *   <Icon name="cross" size={10} color={colors.gold} />
 *
 * All icons are 24×24 viewBox, stroke-based (stroke-width 1.7, round caps/joins).
 * A few icons (sparkle, dove) have small filled accent shapes — these use
 * the fill prop which defaults to the same color as stroke.
 *
 * Dependencies:
 *   yarn add react-native-svg
 *   npx expo install react-native-svg   (if using Expo)
 */

import React from 'react'
import Svg, {
  Path,
  Line,
  Circle,
  Rect,
  Polyline,
  Polygon,
  G,
} from 'react-native-svg'

// ─── Icon name union type ────────────────────────────────────────────────────

export type IconName =
  | 'home'
  | 'groups'
  | 'live'
  | 'book'
  | 'profile'
  | 'user-plus'
  | 'bell'
  | 'cross'
  | 'globe'
  | 'video'
  | 'maximize'
  | 'minimize'
  | 'audio'
  | 'share'
  | 'download'
  | 'calendar'
  | 'plus'
  | 'chevron-r'
  | 'chevron-d'
  | 'back'
  | 'mic-off'
  | 'mic'
  | 'hand'
  | 'chat'
  | 'leave'
  | 'send'
  | 'attach'
  | 'ai'
  | 'flame'
  | 'lock'
  | 'language'
  | 'logout'
  | 'email'
  | 'edit'
  | 'pray'
  | 'prayBridge'
  | 'play'
  | 'settings'
  | 'anchor'
  | 'seedling'
  | 'headphones'
  | 'scroll'
  | 'radio'
  | 'sunrise'
  | 'church'
  | 'heart'
  | 'sparkle'
  | 'compass'
  | 'dove'
  | 'waves'

// ─── Props ───────────────────────────────────────────────────────────────────

interface IconProps {
  name: IconName
  size?: number
  color?: string
  strokeWidth?: number
  style?: object
}

// ─── Shared stroke defaults ───────────────────────────────────────────────────

const DEFAULTS = {
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** prayBridge: pan + scale tuned for tab slot; align with “PRAY” label. */
const PRAY_BRIDGE_TAB = { scale: 0.48, panX: -9.9, panY: -10.8 }

// ─── Component ───────────────────────────────────────────────────────────────

const Icon: React.FC<IconProps> = ({
  name,
  size = 16,
  color = '#2c2417',
  strokeWidth = 1.7,
  style,
}) => {
  const s = { stroke: color, strokeWidth, ...DEFAULTS }
  const sf = { ...s, fill: color, stroke: 'none' } // for filled accent shapes

  const paths: Record<IconName, React.ReactNode> = {

    // ── Navigation ────────────────────────────────────────────────────────────

    home: (
      <G>
        <Path {...s} d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z" />
        <Path {...s} d="M9 21V12h6v9" />
      </G>
    ),

    groups: (
      <G>
        <Circle {...s} cx="9" cy="7" r="3" />
        <Path {...s} d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
        <Path {...s} d="M16 3.13a4 4 0 010 7.75" />
        <Path {...s} d="M21 21v-2a4 4 0 00-3-3.87" />
      </G>
    ),

    live: (
      <G>
        <Rect {...s} x="9" y="2" width="6" height="11" rx="3" />
        <Path {...s} d="M5 10a7 7 0 0014 0" />
        <Line {...s} x1="12" y1="17" x2="12" y2="21" />
        <Line {...s} x1="8" y1="21" x2="16" y2="21" />
      </G>
    ),

    book: (
      <G>
        <Path {...s} d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <Path {...s} d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        <Line {...s} x1="9" y1="7" x2="15" y2="7" />
        <Line {...s} x1="9" y1="11" x2="13" y2="11" />
      </G>
    ),

    profile: (
      <G>
        <Circle {...s} cx="12" cy="8" r="4" />
        <Path {...s} d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </G>
    ),

    'user-plus': (
      <G>
        <Circle {...s} cx="8.5" cy="7" r="3" />
        <Path {...s} d="M2.5 19v-.5a4.5 4.5 0 014.5-4.5h1.5a4.5 4.5 0 014.5 4.5v.5" />
        <Line {...s} x1="17" y1="8" x2="23" y2="8" />
        <Line {...s} x1="20" y1="5" x2="20" y2="11" />
      </G>
    ),

    // ── UI Controls ───────────────────────────────────────────────────────────

    bell: (
      <G>
        <Path {...s} d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <Path {...s} d="M13.73 21a2 2 0 01-3.46 0" />
      </G>
    ),

    plus: (
      <G>
        <Line {...s} x1="12" y1="5" x2="12" y2="19" />
        <Line {...s} x1="5" y1="12" x2="19" y2="12" />
      </G>
    ),

    'chevron-r': (
      <Polyline {...s} points="9 18 15 12 9 6" />
    ),

    'chevron-d': (
      <Polyline {...s} points="6 9 12 15 18 9" />
    ),

    back: (
      <Polyline {...s} points="15 18 9 12 15 6" />
    ),

    share: (
      <G>
        <Path {...s} d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
        <Polyline {...s} points="16 6 12 2 8 6" />
        <Line {...s} x1="12" y1="2" x2="12" y2="15" />
      </G>
    ),

    download: (
      <G>
        <Path {...s} d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
        <Polyline {...s} points="8 12 12 16 16 12" />
        <Line {...s} x1="12" y1="3" x2="12" y2="16" />
      </G>
    ),

    calendar: (
      <G>
        <Rect {...s} x="3" y="4" width="18" height="18" rx="2" />
        <Line {...s} x1="16" y1="2" x2="16" y2="6" />
        <Line {...s} x1="8" y1="2" x2="8" y2="6" />
        <Line {...s} x1="3" y1="10" x2="21" y2="10" />
      </G>
    ),

    edit: (
      <G>
        <Path {...s} d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
        <Path {...s} d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
      </G>
    ),

    settings: (
      <G>
        <Circle {...s} cx="12" cy="12" r="3" />
        <Path
          {...s}
          d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83
             0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4
             0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0
             01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2
             0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0
             012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0
             014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0
             012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2
             0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
        />
      </G>
    ),

    // ── Messaging ─────────────────────────────────────────────────────────────

    chat: (
      <Path {...s} d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    ),

    send: (
      <G>
        <Line {...s} x1="22" y1="2" x2="11" y2="13" />
        <Polygon {...s} fill="none" points="22 2 15 22 11 13 2 9 22 2" />
      </G>
    ),

    attach: (
      <Path
        {...s}
        d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66
           5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
      />
    ),

    // ── Audio / Video ─────────────────────────────────────────────────────────

    mic: (
      <G>
        <Rect {...s} x="9" y="2" width="6" height="11" rx="3" />
        <Path {...s} d="M5 10a7 7 0 0014 0" />
        <Line {...s} x1="12" y1="17" x2="12" y2="21" />
        <Line {...s} x1="8" y1="21" x2="16" y2="21" />
      </G>
    ),

    'mic-off': (
      <G>
        <Line {...s} x1="1" y1="1" x2="23" y2="23" />
        <Path {...s} d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
        <Path {...s} d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23" />
        <Line {...s} x1="12" y1="19" x2="12" y2="23" />
        <Line {...s} x1="8" y1="23" x2="16" y2="23" />
      </G>
    ),

    video: (
      <G>
        <Polygon {...s} fill="none" points="23 7 16 12 23 17 23 7" />
        <Rect {...s} x="1" y="5" width="15" height="14" rx="2" />
      </G>
    ),

    maximize: (
      <G>
        <Polyline {...s} points="4 8 4 4 8 4" />
        <Polyline {...s} points="16 4 20 4 20 8" />
        <Polyline {...s} points="4 16 4 20 8 20" />
        <Polyline {...s} points="20 16 20 20 16 20" />
      </G>
    ),

    minimize: (
      <G>
        <Polyline {...s} points="8 4 4 4 4 8" />
        <Polyline {...s} points="16 4 20 4 20 8" />
        <Polyline {...s} points="4 16 8 20 4 20" />
        <Polyline {...s} points="20 16 20 20 16 20" />
      </G>
    ),

    audio: (
      <G>
        <Polygon {...s} fill="none" points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <Path {...s} d="M15.54 8.46a5 5 0 010 7.07" />
        <Path {...s} d="M19.07 4.93a10 10 0 010 14.14" />
      </G>
    ),

    hand: (
      <G>
        <Path {...s} d="M18 11V6a2 2 0 00-2-2v0a2 2 0 00-2 2v0" />
        <Path {...s} d="M14 10V4a2 2 0 00-2-2v0a2 2 0 00-2 2v2" />
        <Path {...s} d="M10 10.5V6a2 2 0 00-2-2v0a2 2 0 00-2 2v8" />
        <Path
          {...s}
          d="M18 8a2 2 0 114 0v6a8 8 0 01-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2
             2 0 012.83-2.82L7 15"
        />
      </G>
    ),

    leave: (
      <G>
        <Path
          {...s}
          d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84
             0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07
             2 2 0 01-.47-.37"
        />
        <Line {...s} x1="2" y1="2" x2="22" y2="22" />
        <Path
          {...s}
          d="M10.68 13.31A16 16 0 017.07 10C5.47 8 4.32 5.74 3.62 3.24A2 2 0
             015.34 1h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45
             2.11L9.32 8.9"
        />
      </G>
    ),

    radio: (
      <G>
        <Circle {...s} cx="12" cy="12" r="2" />
        <Path {...s} d="M16.24 7.76a6 6 0 010 8.49m-8.48-.01a6 6 0 010-8.49" />
        <Path {...s} d="M19.07 4.93a10 10 0 010 14.14m-14.14 0a10 10 0 010-14.14" />
      </G>
    ),

    play: (
      <G>
        <Circle {...s} cx="12" cy="12" r="10" />
        <Polygon {...s} fill="none" points="10 8 16 12 10 16 10 8" />
      </G>
    ),

    // ── Faith / Spiritual ─────────────────────────────────────────────────────

    cross: (
      <G>
        <Line {...s} x1="12" y1="3" x2="12" y2="21" />
        <Line {...s} x1="4" y1="9" x2="20" y2="9" />
      </G>
    ),

    pray: (
      <G>
        <Path {...s} d="M12 2C10 5 7 9 7 13a5 5 0 0010 0c0-4-3-8-5-11z" />
        <Path {...s} d="M7 13H5a3 3 0 000 6h14a3 3 0 000-6h-2" />
      </G>
    ),

    /**
     * Full DivineBridge mark (LogoOnly1.svg): stroke-only outline, whole group rotated 90° CCW.
     * Scale + pan: full outline in 24×24, optically centered (was sitting right).
     */
    prayBridge: (
      <G
        transform={`translate(${12 + PRAY_BRIDGE_TAB.panX},${12 + PRAY_BRIDGE_TAB.panY}) scale(${PRAY_BRIDGE_TAB.scale}) rotate(-90,20.67109,22.526011) translate(-69.531391,-70.903428)`}
      >
        <Path
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth / PRAY_BRIDGE_TAB.scale}
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M 83.488159,98.975444 H 69.531388 V 115.95545 H 90.26604 c 2.485261,0 5.257993,-0.40936 8.318355,-1.22886 2.238785,-0.59414 4.333645,-1.78274 6.284885,-3.56516 1.95124,-1.80291 3.47135,-4.02543 4.55993,-6.66833 0.70925,-1.70314 1.18872,-2.93472 1.44436,-5.517656 H 96.830497 c -0.174322,1.375766 -0.440514,1.573216 -0.803051,2.413456 -0.698338,1.59803 -1.664104,2.72507 -2.896464,3.38067 -1.232361,0.63512 -3.306806,0.9524 -6.223393,0.9524 h -3.41943 z"
        />
        <Path
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth / PRAY_BRIDGE_TAB.scale}
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m 69.531388,70.903424 v 15.37016 h 13.956771 v -5.16716 h 3.481442 c 3.614925,0 6.202876,0.8808 7.763867,2.64273 0.735039,0.82966 1.293423,1.02256 1.680001,2.52443 h 14.162441 c -0.15907,-0.91803 -0.35436,-0.8424 -0.59221,-1.72551 -0.73942,-2.74534 -1.9308,-5.15254 -3.57394,-7.22178 -1.64315,-2.06925 -3.72754,-3.65669 -6.25388,-4.76302 -2.505805,-1.10633 -5.80251,-1.65985 -9.88984,-1.65985 z"
        />
      </G>
    ),

    dove: (
      <G>
        <Path {...s} d="M12 21C6 21 2 17 2 12c0-3.5 2-6.5 5-8" />
        <Path {...s} d="M20 5c-2-2-5-2-7 0L7 11l5 5 6-6c2-2 2-5 0-7z" />
        <Path {...s} d="M12 16l2 5" />
        <Circle fill={color} stroke="none" cx="17" cy="7" r="1" />
      </G>
    ),

    heart: (
      <Path
        {...s}
        d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78
           7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
      />
    ),

    church: (
      <G>
        <Rect {...s} x="2" y="11" width="20" height="12" />
        <Path {...s} d="M9 23V15h6v8" />
        <Path {...s} d="M12 2v9M8 6h8" />
      </G>
    ),

    // ── Nature / Concepts ────────────────────────────────────────────────────

    flame: (
      <G>
        <Path
          {...s}
          d="M8.5 14.5A2.5 2.5 0 0011 17c1.38 0 2.5-1.12 2.5-2.5 0-1.5-1-2.5-1-4
             0 0 1 1 1 2.5 0 .69.28 1.31.73 1.77A3.5 3.5 0 0015.5 12c0-3-3-5-3-5s.5
             2-2 3.5c-.83.5-2 1.5-2 4z"
        />
        <Path {...s} d="M12 22c-3.31 0-6-2.69-6-6 0-2 1-4 3-5.5" />
      </G>
    ),

    sunrise: (
      <G>
        <Path {...s} d="M17 18a5 5 0 00-10 0" />
        <Line {...s} x1="12" y1="2" x2="12" y2="9" />
        <Line {...s} x1="4.22" y1="10.22" x2="5.64" y2="11.64" />
        <Line {...s} x1="1" y1="18" x2="3" y2="18" />
        <Line {...s} x1="21" y1="18" x2="23" y2="18" />
        <Line {...s} x1="18.36" y1="11.64" x2="19.78" y2="10.22" />
        <Line {...s} x1="23" y1="22" x2="1" y2="22" />
        <Polyline {...s} points="8 6 12 2 16 6" />
      </G>
    ),

    waves: (
      <G>
        <Path {...s} d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5s2.5 2 5 2 2.5-2 5-2 2.4.5 3 1" />
        <Path {...s} d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.4.5 3 1" />
        <Path {...s} d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.4.5 3 1" />
      </G>
    ),

    anchor: (
      <G>
        <Circle {...s} cx="12" cy="5" r="3" />
        <Line {...s} x1="12" y1="8" x2="12" y2="21" />
        <Path {...s} d="M5 12H2a10 10 0 0020 0h-3" />
      </G>
    ),

    seedling: (
      <G>
        <Path {...s} d="M12 22V12" />
        <Path {...s} d="M12 12C12 12 7 11 5 6s5-4 7 2" />
        <Path {...s} d="M12 12c0 0 5-1 7-6s-5-4-7 2" />
      </G>
    ),

    compass: (
      <G>
        <Circle {...s} cx="12" cy="12" r="10" />
        <Polygon {...s} fill="none" points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </G>
    ),

    // ── Text / Content ────────────────────────────────────────────────────────

    scroll: (
      <G>
        <Path {...s} d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <Polyline {...s} points="14 2 14 8 20 8" />
        <Line {...s} x1="16" y1="13" x2="8" y2="13" />
        <Line {...s} x1="16" y1="17" x2="8" y2="17" />
        <Polyline {...s} points="10 9 9 9 8 9" />
      </G>
    ),

    headphones: (
      <G>
        <Path {...s} d="M3 18v-6a9 9 0 0118 0v6" />
        <Path {...s} d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3z" />
        <Path {...s} d="M3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z" />
      </G>
    ),

    // ── Account ───────────────────────────────────────────────────────────────

    lock: (
      <G>
        <Rect {...s} x="3" y="11" width="18" height="11" rx="2" />
        <Path {...s} d="M7 11V7a5 5 0 0110 0v4" />
      </G>
    ),

    language: (
      <G>
        <Path {...s} d="M5 8l6 6" />
        <Path {...s} d="M4 14l6-6 2-3" />
        <Path {...s} d="M2 5h12" />
        <Path {...s} d="M7 2h1" />
        <Path {...s} d="M22 22l-5-10-5 10" />
        <Path {...s} d="M14 18h6" />
      </G>
    ),

    logout: (
      <G>
        <Path {...s} d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
        <Polyline {...s} points="16 17 21 12 16 7" />
        <Line {...s} x1="21" y1="12" x2="9" y2="12" />
      </G>
    ),

    email: (
      <G>
        <Path {...s} d="M4 4h16c1.1 0 2 .9 2 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6c0-1.1.9-2 2-2z" />
        <Polyline {...s} points="22,6 12,13 2,6" />
      </G>
    ),

    // ── AI / Special ─────────────────────────────────────────────────────────

    ai: (
      <Path {...s} d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    ),

    sparkle: (
      <G>
        <Path {...s} d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-5.26L4 11l5.91-1.74z" />
        <Path fill={color} stroke="none" d="M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z" />
        <Path fill={color} stroke="none" d="M18 17l.4 1.2 1.2.4-1.2.4L18 20.4l-.4-1.4-1.2-.4 1.2-.4z" />
      </G>
    ),

    globe: (
      <G>
        <Circle {...s} cx="12" cy="12" r="9" />
        <Path {...s} d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
      </G>
    ),
  }

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
    >
      {paths[name]}
    </Svg>
  )
}

export default Icon
