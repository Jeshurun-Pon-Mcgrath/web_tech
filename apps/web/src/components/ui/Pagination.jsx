import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Select } from './index';
export default function Pagination({
  pagination,
  onChange,
  loading,
  label = 'Records',
  pageSizes = true,
}) {
  if (!pagination) return null;
  const { page, pageSize, total, totalPages, hasPrevious, hasNext } = pagination;
  return (
    <nav className="pagination" aria-label={`${label} pagination`} aria-busy={loading || undefined}>
      <span role="status">
        Page {page} of {totalPages} · {total} record{total === 1 ? '' : 's'}
      </span>
      {pageSizes && (
        <Select
          label={`${label} per page`}
          value={pageSize}
          disabled={loading}
          onChange={(e) => onChange('pageSize', e.target.value)}
        >
          {[10, 20, 50].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      )}
      <div className="row-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={loading || !hasPrevious}
          aria-label={`Previous ${label.toLowerCase()} page`}
          onClick={() => onChange('page', page - 1)}
        >
          <ChevronLeft size={16} />
          Previous
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={loading || !hasNext}
          aria-label={`Next ${label.toLowerCase()} page`}
          onClick={() => onChange('page', page + 1)}
        >
          Next
          <ChevronRight size={16} />
        </Button>
      </div>
    </nav>
  );
}
