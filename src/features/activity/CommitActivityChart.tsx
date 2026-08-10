import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '../../i18n/i18n';

export interface CommitActivityChartDatum {
  label: string;
  commits: number;
}

export interface CommitActivityChartProps {
  data: CommitActivityChartDatum[];
}

export default function CommitActivityChart({ data }: CommitActivityChartProps) {
  const { t } = useI18n();
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={112}>
      <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 4, left: -20 }}>
        <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="label"
          axisLine={false}
          interval="preserveStartEnd"
          tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
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
            fontSize: 11,
          }}
        />
        <Bar
          dataKey="commits"
          name={t('activityCommits')}
          fill="var(--accent)"
          maxBarSize={24}
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
