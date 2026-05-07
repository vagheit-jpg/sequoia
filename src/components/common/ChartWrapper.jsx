import { ResponsiveContainer } from "recharts";

export default function CW({ children, h = 200 }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <ResponsiveContainer width="100%" height={h}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}
