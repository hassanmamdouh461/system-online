import { Order, OrderItem, OrderStatus } from '../types/order';

export function getItemSection(category: string, name: string): 'kitchen' | 'drinks' {
  return 'drinks';
}

/**
 * Filter items of an order by destination section.
 */
export function filterItemsBySection(items: OrderItem[], section: 'all' | 'kitchen' | 'drinks'): OrderItem[] {
  if (section === 'all' || section === 'drinks') return items;
  if (section === 'kitchen') return [];
  return items;
}

/**
 * Calculate the status of an order for a specific section based on its items' statuses.
 */
export function getOrderStatusForSection(order: Order, section: 'all' | 'kitchen' | 'drinks'): OrderStatus {
  if (order.status === 'Cancelled') return 'Cancelled';
  if (order.status === 'Completed') return 'Completed';

  if (section === 'all') {
    const items = order.items;
    if (items.length === 0) return order.status;
    const statuses = items.map(item => item.status || order.status || 'New');
    if (statuses.every(s => s === 'Completed')) return 'Completed';
    if (statuses.every(s => s === 'Ready' || s === 'Completed')) return 'Ready';
    if (statuses.includes('Preparing') || statuses.includes('Ready')) return 'Preparing';
    return 'New';
  }

  const items = filterItemsBySection(order.items, section);
  if (items.length === 0) {
    return 'Ready'; // If no items for this section, treat as ready so it doesn't block overall order status.
  }

  const statuses = items.map(item => item.status || order.status || 'New');
  
  if (statuses.every(s => s === 'Completed')) {
    return 'Completed';
  }
  if (statuses.every(s => s === 'Ready' || s === 'Completed')) {
    return 'Ready';
  }
  if (statuses.includes('Preparing') || statuses.includes('Ready')) {
    return 'Preparing';
  }
  return 'New';
}
