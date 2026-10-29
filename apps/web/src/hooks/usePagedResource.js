import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useResource } from './useResource';
const fields = [
  'page',
  'pageSize',
  'search',
  'sort',
  'order',
  'active',
  'cohort',
  'subject',
  'type',
  'archived',
  'status',
  'released',
  'exam',
  'student',
  'reviewStatus',
  'hasEvents',
  'view',
  'accountStatus',
  'topic',
  'difficulty',
  'tag',
  'attempts',
  'passPercent',
  'questionPage',
];
export function usePagedResource(path, namespace = '', fixed = '') {
  const [params, setParams] = useSearchParams();
  const key = (field) => (namespace ? `${namespace}.${field}` : field);
  const query = new URLSearchParams(fixed);
  for (const field of fields) {
    const value = params.get(key(field));
    if (value) query.set(field, value);
  }
  const resource = useResource(path ? `${path}?${query}` : null);
  const externalSearch = params.get(key('search')) || '';
  const [search, setSearchValue] = useState(externalSearch);
  const debounce = useRef(null);
  useEffect(() => {
    setSearchValue(externalSearch);
    clearTimeout(debounce.current);
  }, [externalSearch]);
  useEffect(() => () => clearTimeout(debounce.current), []);
  function update(field, value, replace = false) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        const fieldKey = namespace ? `${namespace}.${field}` : field;
        if (value) next.set(fieldKey, String(value));
        else next.delete(fieldKey);
        if (field !== 'page') next.delete(namespace ? `${namespace}.page` : 'page');
        if (field !== 'questionPage')
          next.delete(namespace ? `${namespace}.questionPage` : 'questionPage');
        return next;
      },
      { replace },
    );
  }
  function setSearch(value) {
    setSearchValue(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => update('search', value, true), 300);
  }
  const actualPage = resource.data?.pagination.page;
  const requestedPage = query.get('page');
  useEffect(() => {
    if (actualPage && requestedPage && Number(requestedPage) !== actualPage) {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set(namespace ? `${namespace}.page` : 'page', String(actualPage));
          return next;
        },
        { replace: true },
      );
    }
  }, [actualPage, requestedPage, namespace, setParams]);
  function clear() {
    clearTimeout(debounce.current);
    setSearchValue('');
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const field of fields) next.delete(namespace ? `${namespace}.${field}` : field);
      return next;
    });
  }
  return {
    ...resource,
    items: resource.data?.items || [],
    pagination: resource.data?.pagination,
    query,
    search,
    setSearch,
    update,
    clear,
  };
}
