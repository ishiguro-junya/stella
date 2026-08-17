import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface CommitActivityChartDatum {
  label: string;
  value: number;
}

export interface CommitActivityChartProps {
  data: CommitActivityChartDatum[];
  metricLabel: string;
}

export default function CommitActivityChart({ data, metricLabel }: CommitActivityChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={112}>
      <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
        <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="label"
          axisLine={false}
          interval="preserveStartEnd"
          tick={{ fill: 'var(--text-tertiary)', fontSize: '0.625rem' }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tick={{ fill: 'var(--text-tertiary)', fontSize: '0.625rem' }}
          tickLine={false}
          width={36}
        />
        <Tooltip
          cursor={{ fill: 'var(--selection-muted)' }}
          contentStyle={{
            background: 'var(--surface-overlay)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            color: 'var(--text-primary)',
            fontSize: '0.6875rem',
          }}
        />
        <Bar
          dataKey="value"
          name={metricLabel}
          fill="var(--accent)"
          isAnimationActive={false}
          maxBarSize={24}
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
