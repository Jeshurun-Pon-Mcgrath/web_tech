import { useEffect, useMemo, useState } from 'react';
import { useResource } from '../../hooks/useResource';
import { Button, ErrorMessage, Input, Select } from './index';
import Pagination from './Pagination';
function useOptions(resource, filter = '') {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setPage(1);
  }, [filter]);
  const query = new URLSearchParams(filter);
  query.set('page', page);
  query.set('pageSize', '20');
  query.set('search', debounced);
  const data = useResource(`/admin/${resource}?${query}`);
  return {
    ...data,
    search,
    setSearch,
    update: (field, value) => {
      if (field === 'page') setPage(value);
    },
  };
}
export function ResourceSelect({
  resource,
  label,
  value,
  onChange,
  required = false,
  autoFirst = false,
}) {
  const options = useOptions(resource);
  const selected = useResource(
    value && !options.data?.items.some((item) => item.id === value)
      ? `/admin/${resource}/${value}`
      : null,
  );
  const rows = useMemo(() => options.data?.items || [], [options.data]);
  useEffect(() => {
    if (autoFirst && !value && rows.length) onChange(rows[0].id);
  }, [autoFirst, value, rows, onChange]);
  return (
    <div className="resource-select">
      <Select
        label={label}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      >
        <option value="">{required ? 'Select…' : 'None'}</option>
        {selected.data && !rows.some((row) => row.id === selected.data.id) && (
          <option value={selected.data.id}>{selected.data.name || selected.data.title}</option>
        )}
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name || row.title}
          </option>
        ))}
      </Select>
      <details>
        <summary>Search {label.toLowerCase()} options</summary>
        <Input
          label={`Search ${label.toLowerCase()} options`}
          value={options.search}
          onChange={(e) => options.setSearch(e.target.value)}
        />
        <ErrorMessage error={options.error || selected.error} />
        <div className="row-actions">
          <Button
            type="button"
            variant="text"
            disabled={!options.data?.pagination.hasPrevious || options.loading}
            onClick={() => options.update('page', options.data.pagination.page - 1)}
          >
            Previous options
          </Button>
          <Button
            type="button"
            variant="text"
            disabled={!options.data?.pagination.hasNext || options.loading}
            onClick={() => options.update('page', options.data.pagination.page + 1)}
          >
            Next options
          </Button>
        </div>
      </details>
    </div>
  );
}
export function ResourceChecklist({ resource, label, values, onToggle, filter = '' }) {
  const options = useOptions(resource, filter);
  return (
    <fieldset className="resource-checklist">
      <legend>
        {label} ({values.length} selected)
      </legend>
      <Input
        label={`Search ${label.toLowerCase()}`}
        value={options.search}
        onChange={(e) => options.setSearch(e.target.value)}
      />
      <ErrorMessage error={options.error} />
      <div className="selection-list" aria-busy={options.loading || undefined}>
        {options.loading ? (
          <p role="status">Loading options…</p>
        ) : options.data?.items.length ? (
          options.data.items.map((row) => (
            <label key={row.id} className="check">
              <input
                type="checkbox"
                checked={values.includes(row.id)}
                onChange={() => onToggle(row.id)}
              />
              <span>{row.name || row.prompt || row.title}</span>
            </label>
          ))
        ) : (
          <p className="muted">No matching options.</p>
        )}
      </div>
      <Pagination
        pagination={options.data?.pagination}
        loading={options.loading}
        label={label}
        pageSizes={false}
        onChange={options.update}
      />
    </fieldset>
  );
}
