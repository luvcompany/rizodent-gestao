import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const CRM_MOBILE_BREAKPOINT = 1024;

function useBreakpointBelow(breakpoint: number) {
  const [isBelow, setIsBelow] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsBelow(window.innerWidth < breakpoint);
    mql.addEventListener("change", onChange);
    setIsBelow(window.innerWidth < breakpoint);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return !!isBelow;
}

export function useIsMobile() {
  return useBreakpointBelow(MOBILE_BREAKPOINT);
}

// CRM-specific: treat tablets and below as "mobile" since the CRM
// uses 3-panel layouts that don't fit comfortably under 1024px.
export function useIsCrmMobile() {
  return useBreakpointBelow(CRM_MOBILE_BREAKPOINT);
}
