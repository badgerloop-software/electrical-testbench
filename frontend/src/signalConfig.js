// Signal configuration dynamically loaded from format.json
// Format: [size_bytes, datatype, units, min, max, "subsystem;description"]
import formatData from '../../sc-data-format/format.json';

const SIGNAL_CONFIG = {};
for (const [name, arr] of Object.entries(formatData)) {
  SIGNAL_CONFIG[name] = arr.slice(0, 6);
}

export { SIGNAL_CONFIG };

// Helper to get signals grouped by category
export const getSignalsByCategory = () => {
  const categories = {};
  Object.entries(SIGNAL_CONFIG).forEach(([name, config]) => {
    const category = config[5].split(';')[0];
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(name);
  });
  return categories;
};
