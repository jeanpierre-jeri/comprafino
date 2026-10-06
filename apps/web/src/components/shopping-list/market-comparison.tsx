import { BasketComparison } from "../basket-comparison";
import type { ShoppingListItem, BasketPlan } from "@comprafino/core";

type Props = {
  pending: boolean;
  error: string;
  retry: () => void;
  plans: readonly BasketPlan[];
  items: readonly ShoppingListItem[];
  selectedLimit: number | null;
  selectLimit: (limit: number) => void;
};

export function MarketComparison({ pending, error, retry, ...basket }: Props) {
  if (pending) return <p>Comparando precios actuales…</p>;

  if (error) {
    return (
      <>
        <p role="alert">{error}</p>
        <button className="card-link" onClick={retry}>
          Reintentar
        </button>
      </>
    );
  }

  return <BasketComparison {...basket} />;
}
