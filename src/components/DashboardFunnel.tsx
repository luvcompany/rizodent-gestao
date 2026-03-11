interface FunnelItem {
  name: string;
  value: number;
  fill: string;
}

const DashboardFunnel = ({ data }: { data: FunnelItem[] }) => {
  const maxValue = Math.max(...data.map(d => d.value), 1);

  return (
    <div className="flex flex-col items-center gap-1 py-4">
      {data.map((item, i) => {
        const widthPercent = Math.max((item.value / maxValue) * 100, 20);
        const convRate = i > 0 && data[0].value > 0
          ? ((item.value / data[0].value) * 100).toFixed(1)
          : null;

        return (
          <div key={item.name} className="flex flex-col items-center w-full">
            <div
              className="relative flex items-center justify-center py-3 text-sm font-semibold text-white transition-all rounded-sm"
              style={{
                width: `${widthPercent}%`,
                backgroundColor: item.fill,
                clipPath: i < data.length - 1
                  ? "polygon(4% 0%, 96% 0%, 100% 100%, 0% 100%)"
                  : "polygon(4% 0%, 96% 0%, 96% 100%, 4% 100%)",
                minHeight: "48px",
              }}
            >
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-base font-bold">{item.value}</span>
                <span className="text-xs opacity-90">{item.name}</span>
              </div>
              {convRate && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs opacity-75">
                  {convRate}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DashboardFunnel;
