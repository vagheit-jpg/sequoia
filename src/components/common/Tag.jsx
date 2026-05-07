export default function Tag({ children, color, size = 10 }) {
  return (
    <span
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
        borderRadius: 4,
        padding: "2px 6px",
        fontSize: size,
        fontWeight: 700,
      }}
    >
      {children}
    </span>
  );
}
