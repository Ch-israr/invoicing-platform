"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Dashboard charts (Recharts). All data arrives as plain numbers from
 * the server — the report service computes it from the ledger, this
 * file only draws it. Empty states are rendered by the parent page.
 */

const STATUS_COLORS: Record<string, string> = {
  ISSUED: "#2563eb",
  SENT: "#4f46e5",
  PARTIALLY_PAID: "#d97706",
};

function moneyTick(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

export function RevenueChart({
  data,
}: {
  data: Array<{ month: string; invoiced: number; paid: number }>;
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={moneyTick} tick={{ fontSize: 12 }} width={48} />
          <Tooltip
            formatter={(value) => [
              typeof value === "number" ? value.toFixed(2) : value,
            ]}
          />
          <Legend />
          <Bar dataKey="invoiced" name="Invoiced" fill="#2563eb" radius={[4, 4, 0, 0]} />
          <Bar dataKey="paid" name="Paid" fill="#16a34a" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OutstandingChart({
  data,
}: {
  data: Array<{ status: string; balance: number; count: number }>;
}) {
  const label: Record<string, string> = {
    ISSUED: "Issued",
    SENT: "Sent",
    PARTIALLY_PAID: "Partially paid",
  };
  // The legend reads nameKey, so give each slice a human label — the
  // raw status string (PARTIALLY_PAID) used to show up in the legend.
  const dataWithLabels = data.map((d) => ({
    ...d,
    label: label[d.status] ?? d.status,
  }));
  const total = data.reduce((sum, d) => sum + d.balance, 0);
  return (
    <div className="relative h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={dataWithLabels}
            dataKey="balance"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
          >
            {dataWithLabels.map((d) => (
              <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? "#64748b"} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, _name, props) => [
              typeof value === "number" ? value.toFixed(2) : value,
              `${props?.payload?.label ?? props?.payload?.status} (${props?.payload?.count ?? 0} invoices)`,
            ]}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-8">
        <span className="text-xl font-bold tabular-nums">
          {total.toFixed(2)}
        </span>
        <span className="text-xs text-muted-foreground">outstanding</span>
      </div>
    </div>
  );
}

export function TopCustomersChart({
  data,
}: {
  data: Array<{ name: string; total: number }>;
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis type="number" tickFormatter={moneyTick} tick={{ fontSize: 12 }} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 12 }}
            width={130}
            tickFormatter={(value: string) =>
              value.length > 18 ? `${value.slice(0, 17)}…` : value
            }
          />
          <Tooltip
            formatter={(value) => [
              typeof value === "number" ? value.toFixed(2) : value,
              "Billed",
            ]}
          />
          <Bar
            dataKey="total"
            name="Billed"
            fill="#2563eb"
            radius={[0, 4, 4, 0]}
            barSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
