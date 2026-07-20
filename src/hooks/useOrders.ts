import { useOrdersContext } from '../context/DataContext';

// Re-export from DataContext - data is fetched once at app level and shared
export function useOrders() {
  return useOrdersContext();
}
