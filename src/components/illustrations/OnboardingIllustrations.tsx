// src/components/illustrations/OnboardingIllustrations.tsx
//
// Premium line-art illustrations for onboarding, built from scratch as SVG
// (react-native-svg) rather than icon-font glyphs. Brand-compliant by
// construction: every stroke/fill here is theme.accent (neon #4DEE54),
// theme.text/theme.bg (ink, light/dark-aware), or BRAND.neon at reduced
// alpha for soft backdrops — no third color is ever introduced. Because
// everything is driven by useTheme() rather than fixed hex values, these
// render correctly in both light and dark mode automatically.
//
// Each illustration animates in with a soft spring (fade + scale + rise)
// when it becomes the active onboarding slide, plus a continuous, very
// subtle float loop so the screen feels alive rather than static — common
// in premium onboarding flows (Stripe/Linear/Notion-style motion).
import React, { useEffect } from "react";
import Svg, { Circle, Path, Rect, Line, G } from "react-native-svg";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  Easing,
} from "react-native-reanimated";

import { BRAND, Theme } from "@/src/theme/tokens";

const AnimatedSvg = Animated.createAnimatedComponent(Svg);

function useEntrance(active: boolean) {
  const progress = useSharedValue(0);
  const float = useSharedValue(0);

  useEffect(() => {
    if (active) {
      progress.value = withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) });
      float.value = withDelay(
        500,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 1900, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: 1900, easing: Easing.inOut(Easing.sin) })
          ),
          -1,
          false
        )
      );
    } else {
      progress.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.cubic) });
      float.value = 0;
    }
  }, [active]);

  const style = useAnimatedStyle(() => {
    const rise = (1 - progress.value) * 18 - float.value * 4;
    const scale = 0.86 + progress.value * 0.14;
    return {
      opacity: progress.value,
      transform: [{ translateY: rise }, { scale }],
    };
  });

  return style;
}

type IllustrationProps = { theme: Theme; active: boolean; size?: number };

function Backdrop({ theme }: { theme: Theme }) {
  const soft = theme.bg === "#060807" ? `${BRAND.neon}1F` : `${BRAND.neon}17`;
  return <Circle cx={60} cy={60} r={52} fill={soft} />;
}

/** Slide 1 — "Your keys stay on your phone." Phone outline holding a shield. */
export function SecurityIllustration({ theme, active, size = 152 }: IllustrationProps) {
  const style = useEntrance(active);
  const ink = theme.bg === "#060807" ? theme.text : BRAND.ink;
  return (
    <AnimatedSvg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Backdrop theme={theme} />
      <G>
        <Rect x={38} y={24} width={44} height={72} rx={10} stroke={theme.accent} strokeWidth={3.2} fill="none" />
        <Line x1={48} y1={34} x2={72} y2={34} stroke={theme.accent} strokeWidth={3.2} strokeLinecap="round" />
        <Path
          d="M60 50 L74 56 V70 C74 79 68 85 60 88 C52 85 46 79 46 70 V56 Z"
          stroke={ink}
          strokeWidth={3.2}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill={theme.bg}
        />
        <Path d="M53 69 L58 74 L68 63" stroke={theme.accent} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </G>
    </AnimatedSvg>
  );
}

/** Slide 2 — "Built for the Electroneum ecosystem." Hexagon hub + node network. */
export function NetworkIllustration({ theme, active, size = 152 }: IllustrationProps) {
  const style = useEntrance(active);
  const nodes = [
    { x: 60, y: 24 },
    { x: 94, y: 44 },
    { x: 94, y: 80 },
    { x: 60, y: 100 },
    { x: 26, y: 80 },
    { x: 26, y: 44 },
  ];
  return (
    <AnimatedSvg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Backdrop theme={theme} />
      <G>
        {nodes.map((n, i) => (
          <Line key={i} x1={60} y1={62} x2={n.x} y2={n.y} stroke={theme.accent} strokeWidth={2} strokeOpacity={0.55} />
        ))}
        {nodes.map((n, i) => (
          <Circle key={i} cx={n.x} cy={n.y} r={5} fill={theme.bg} stroke={theme.accent} strokeWidth={2.4} />
        ))}
        {/* central hexagon, echoing the brand mark */}
        <Path
          d="M60 44 L76 53 V71 L60 80 L44 71 V53 Z"
          stroke={theme.accent}
          strokeWidth={3.4}
          strokeLinejoin="round"
          fill={theme.bg}
        />
        <Circle cx={60} cy={62} r={7} fill={theme.accent} />
      </G>
    </AnimatedSvg>
  );
}

/** Slide 3 — "Manage more than one wallet." Two overlapping account cards. */
export function AccountsIllustration({ theme, active, size = 152 }: IllustrationProps) {
  const style = useEntrance(active);
  const ink = theme.bg === "#060807" ? theme.text : BRAND.ink;
  return (
    <AnimatedSvg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Backdrop theme={theme} />
      <G>
        <Rect x={26} y={38} width={62} height={40} rx={12} stroke={ink} strokeWidth={2.6} fill={theme.bg} opacity={0.55} />
        <Rect x={34} y={50} width={64} height={40} rx={12} stroke={theme.accent} strokeWidth={3.2} fill={theme.bg} />
        <Circle cx={48} cy={68} r={7} stroke={theme.accent} strokeWidth={2.6} fill="none" />
        <Line x1={62} y1={64} x2={88} y2={64} stroke={theme.accent} strokeWidth={2.6} strokeLinecap="round" />
        <Line x1={62} y1={74} x2={80} y2={74} stroke={theme.accent} strokeWidth={2.6} strokeLinecap="round" strokeOpacity={0.6} />
      </G>
    </AnimatedSvg>
  );
}

/** Slide 4 — "Explore dApps, track every transaction." Browser + compass. */
export function BrowserIllustration({ theme, active, size = 152 }: IllustrationProps) {
  const style = useEntrance(active);
  const ink = theme.bg === "#060807" ? theme.text : BRAND.ink;
  return (
    <AnimatedSvg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Backdrop theme={theme} />
      <G>
        <Rect x={24} y={30} width={72} height={58} rx={12} stroke={theme.accent} strokeWidth={3} fill={theme.bg} />
        <Line x1={24} y1={44} x2={96} y2={44} stroke={theme.accent} strokeWidth={2} strokeOpacity={0.5} />
        <Circle cx={33} cy={37} r={2} fill={theme.accent} />
        <Circle cx={41} cy={37} r={2} fill={theme.accent} opacity={0.6} />
        <Circle cx={49} cy={37} r={2} fill={theme.accent} opacity={0.4} />
        <Circle cx={60} cy={67} r={16} stroke={ink} strokeWidth={2.8} fill="none" />
        <Path d="M60 58 L64 63 L60 76 L56 63 Z" fill={theme.accent} />
      </G>
    </AnimatedSvg>
  );
}

/** Slide 5 — "Know the moment funds arrive." Bell with pulse rings. */
export function NotificationsIllustration({ theme, active, size = 152 }: IllustrationProps) {
  const style = useEntrance(active);
  const ink = theme.bg === "#060807" ? theme.text : BRAND.ink;
  return (
    <AnimatedSvg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Backdrop theme={theme} />
      <G>
        <Circle cx={60} cy={54} r={30} stroke={theme.accent} strokeWidth={1.6} strokeOpacity={0.28} fill="none" />
        <Circle cx={60} cy={54} r={21} stroke={theme.accent} strokeWidth={1.8} strokeOpacity={0.45} fill="none" />
        <Path
          d="M60 30 C68 30 74 37 74 46 V58 L80 68 H40 L46 58 V46 C46 37 52 30 60 30 Z"
          stroke={ink}
          strokeWidth={3}
          strokeLinejoin="round"
          fill={theme.bg}
        />
        <Path d="M53 68 C53 73 56 76 60 76 C64 76 67 73 67 68" stroke={ink} strokeWidth={3} strokeLinecap="round" fill="none" />
        <Circle cx={78} cy={38} r={6.5} fill={theme.accent} />
      </G>
    </AnimatedSvg>
  );
}

export const ONBOARDING_ILLUSTRATIONS = {
  security: SecurityIllustration,
  electroneum: NetworkIllustration,
  accounts: AccountsIllustration,
  browser: BrowserIllustration,
  notifications: NotificationsIllustration,
} as const;
