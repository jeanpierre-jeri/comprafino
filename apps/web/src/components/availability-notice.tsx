/** Stock evidence is independent of price freshness; unknown is never inferred as available. */
export function AvailabilityNotice({ available }: { available: boolean | null }) {
  let label;

  if (available === false) {
    label = "No disponible en la última consulta.";
  } else if (available === true) {
    label = "Disponible en la última consulta.";
  } else {
    label = "Disponibilidad no confirmada.";
  }

  return <p className="mt-2 text-sm text-muted-foreground">{label}</p>;
}
