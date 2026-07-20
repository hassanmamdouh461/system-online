import { useMenuContext } from '../context/DataContext';

// Re-export from DataContext - data is fetched once at app level and shared
export function useMenu() {
  return useMenuContext();
}
