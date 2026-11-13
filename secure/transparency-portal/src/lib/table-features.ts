import { createPaginatedRowModel, rowPaginationFeature, tableFeatures } from "@tanstack/react-table";

// v9 tree-shakes unregistered features, so declare exactly what the tables use: client-side pagination.
export const dataTableFeatures = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

export type DataTableFeatures = typeof dataTableFeatures;
