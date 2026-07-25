import { Order, OrderItem, OrderStatus } from '../types/order';

/**
 * Resolve which station prepares an item.
 *
 * Menu categories are stored as "MenuCategory|PrepDestination" (e.g.
 * "ساندوتشات|Kitchen", "Hot Coffee|Bar"), which is what the menu editor writes
 * and what the boot migration normalises to. The prep destination after the
 * pipe is the authoritative routing signal.
 *
 * Previously this function ignored both arguments and unconditionally returned
 * 'drinks', so filterItemsBySection(items, 'kitchen') was always empty and
 * kitchen tickets never printed.
 */
export function getItemSection(category?: string, name?: string): 'kitchen' | 'drinks' {
  const raw = String(category || '');

  if (raw.includes('|')) {
    const dest = raw.split('|')[1]?.trim().toLowerCase();
    if (dest === 'kitchen') return 'kitchen';
    if (dest === 'bar') return 'drinks';
  }

  // Legacy rows saved before the piped format existed.
  const flat = raw.trim().toLowerCase();
  if (flat === 'kitchen' || flat === 'food' || flat === 'chicken meals') return 'kitchen';

  const KITCHEN_CATEGORIES = ['مأكولات', 'ساندوتشات', 'مقبلات', 'حلويات'];
  if (KITCHEN_CATEGORIES.some((c) => raw.includes(c))) return 'kitchen';

  // Last resort: some very old items carry no category at all.
  const label = String(name || '').toLowerCase();
  const KITCHEN_KEYWORDS = [
    'sandwich', 'burger', 'fries', 'cake', 'brownie', 'crepe', 'waffle', 'pasta',
    'ساندوتش', 'برجر', 'بطاطس', 'كيك', 'براوني', 'كريب', 'وافل', 'مكرونة',
  ];
  if (KITCHEN_KEYWORDS.some((k) => label.includes(k))) return 'kitchen';

  return 'drinks';
}

/**
 * Filter items of an order by destination section.
 */
export function filterItemsBySection(items: OrderItem[], section: 'all' | 'kitchen' | 'drinks'): OrderItem[] {
  if (section === 'all') return items;
  return (items || []).filter((item) => getItemSection(item.category, item.name) === section);
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
