// Componentes base do redesign do CRM (pacote F3). Só visual: sem dados,
// sem estado de negócio e sem texto fixo.
export { TONES, toneClasses, toneColor, isTone } from "./tones";
export type { Tone, ToneClasses } from "./tones";
export { renderIcon, ICON_STROKE } from "./icon";
export { normalizeChannel, conversationChannel, initialsOf, sparklinePoints, hexWithAlpha, PILL_BG_ALPHA_HEX } from "./helpers";
export type { KnownChannel, ChannelVariant } from "./helpers";
export type { IconLike } from "./icon";

export { PageHeader } from "./PageHeader";
export type { PageHeaderProps, BreadcrumbItem } from "./PageHeader";
export { SectionCard } from "./SectionCard";
export type { SectionCardProps } from "./SectionCard";
export { KpiCard } from "./KpiCard";
export type { KpiCardProps, KpiDelta, SemanticTone } from "./KpiCard";
export { MiniStat } from "./MiniStat";
export type { MiniStatProps } from "./MiniStat";
export { ChartCard } from "./ChartCard";
export type { ChartCardProps } from "./ChartCard";
export { ChartTooltip } from "./ChartTooltip";
export type { ChartTooltipProps, ChartTooltipItem, ChartTooltipFormatter } from "./ChartTooltip";
export { PillTabs } from "./PillTabs";
export type { PillTabsProps, PillTabItem } from "./PillTabs";
export { StatusPill } from "./StatusPill";
export type { StatusPillProps } from "./StatusPill";
export { ChannelIcon } from "./ChannelIcon";
export type { ChannelIconProps } from "./ChannelIcon";
export { InitialsAvatar } from "./InitialsAvatar";
export type { InitialsAvatarProps, AvatarSize } from "./InitialsAvatar";
export { ListRow } from "./ListRow";
export type { ListRowProps } from "./ListRow";
export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";
export { ErrorBanner } from "./ErrorBanner";
export type { ErrorBannerProps } from "./ErrorBanner";
export { FilterBar } from "./FilterBar";
export type { FilterBarProps } from "./FilterBar";
export { SearchInput } from "./SearchInput";
export type { SearchInputProps } from "./SearchInput";
export { Sparkline } from "./Sparkline";
export type { SparklineProps } from "./Sparkline";

export { buildCrmChartTheme, areaGradientStops, CHART_SERIES } from "./chartTheme";
export type { CrmChartTheme, GradientStop } from "./chartTheme";
export { useCrmChartTheme } from "./useCrmChartTheme";
