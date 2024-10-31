import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import { BaseInventoryColumn, InventoryColumn, LocalColumnData } from './InventoryColumn';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { DateFormat } from '@redhat-cloud-services/frontend-components/DateFormat';
import SecurityIcon from '@patternfly/react-icons/dist/dynamic/icons/security-icon';
import TagIcon from '@patternfly/react-icons/dist/dynamic/icons/tag-icon';

import { Host, getHostCVEs, getHostTags, getHosts } from './api';
import { Checkbox } from '@patternfly/react-core/dist/dynamic/components/Checkbox';
import { Icon } from '@patternfly/react-core/dist/dynamic/components/Icon';
import { Skeleton } from '@patternfly/react-core/dist/dynamic/components/Skeleton';
import { Toolbar, ToolbarContent, ToolbarItem } from '@patternfly/react-core/dist/dynamic/components/Toolbar';

function createRows(
  columns: {
    isReady?: () => boolean;
    isAsync?: () => boolean;
    getColumnData: () => LocalColumnData;
  }[]
) {
  const rowNumber = columns.reduce<number>((acc, column) => {
    if (!column.isAsync?.()) {
      return Math.max(acc, column.getColumnData().length);
    }
    return acc;
  }, 0);
  const allData = columns.reduce<ReactNode[][]>((acc, column) => {
    if (column.isAsync?.() && !column.isReady?.()) {
      for (let i = 0; i < rowNumber; i++) {
        if (!acc[i]) {
          acc[i] = [];
        }
        acc[i].push(<Skeleton />);
      }

      return acc;
    }
    const data = column.getColumnData();
    for (let i = 0; i < data.length; i++) {
      if (!acc[i]) {
        acc[i] = [];
      }
      acc[i].push(data[i]);
    }
    return acc;
  }, []);

  return allData;
}

function useColumnData(columns: InventoryColumn[]) {
  const hasRemoteColumns = columns.some((column) => {
    return column.isAsync?.();
  });
  const [ready, setReady] = React.useState(!hasRemoteColumns);
  function initLocalData() {
    if (hasRemoteColumns) {
      return new Array(columns.length).fill([]);
    }
    return createRows(
      columns as {
        isAsync?: () => boolean;
        getColumnData: () => LocalColumnData;
      }[]
    );
  }
  const [data, setData] = React.useState<ReactNode[][]>(initLocalData);
  console.log({ data });

  useEffect(() => {
    setReady(!hasRemoteColumns);
    setData(
      createRows(
        columns as {
          isAsync?: () => boolean;
          getColumnData: () => LocalColumnData;
        }[]
      )
    );
    const promises: Promise<void>[] = [];
    for (let i = 0; i < columns.length; i++) {
      if (columns[i].isAsync?.() && typeof columns[i].observeReady === 'function') {
        const P = new Promise<void>((resolve) => {
          columns[i].observeReady?.(resolve);
        });
        promises.push(P);
        P.then(() => {
          setData(
            createRows(
              columns as {
                isAsync?: () => boolean;
                getColumnData: () => LocalColumnData;
              }[]
            )
          );
        });
      }
    }

    return () => {
      setReady(true);
      setData([]);
    };
  }, [columns]);

  const res = useMemo<[ReactNode[][], boolean]>(() => [data, ready], [data, ready]);

  return res;
}

const ModularInventory = ({ columns }: { columns: Omit<InventoryColumn, 'isReady' | 'isAsync' | 'observeReady'>[] }) => {
  const [allData] = useColumnData(columns as InventoryColumn[]);
  return (
    <Table>
      <Thead>
        <Tr>
          {columns.map((column) => (
            <Th key={column.getColumnId()}>{column.getTitle()}</Th>
          ))}
        </Tr>
      </Thead>
      <Tbody>
        {allData.map((row, index) => (
          <Tr key={index}>
            {row.map((cell, cellIndex) => (
              <Td key={cellIndex}>{cell}</Td>
            ))}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
};

const columnIds = ['id', 'name', 'all-cves', 'cves', 'tags', 'os', 'lastCheckIn'];
const ColumnEnabler = ({
  enabledColumns,
  handleCheckboxChange,
}: {
  enabledColumns: { [key: string]: boolean };
  handleCheckboxChange: (columnId: string) => void;
}) => {
  return (
    <Toolbar>
      <ToolbarContent>
        {columnIds.map((columnId) => (
          <ToolbarItem key={columnId}>
            <Checkbox isChecked={enabledColumns[columnId]} onChange={() => handleCheckboxChange(columnId)} label={columnId} id={columnId} />
          </ToolbarItem>
        ))}
      </ToolbarContent>
    </Toolbar>
  );
};

const columnsRegistry: {
  [key: string]: (hosts: Host[], cvePromises: ReturnType<typeof getHostCVEs>[]) => InventoryColumn | BaseInventoryColumn;
} = {
  id: (hosts: Host[]) => {
    return new BaseInventoryColumn('id', 'System ID', {
      columnData: hosts.map((host) => host.id),
    });
  },

  name: (hosts: Host[]) => {
    return new BaseInventoryColumn('name', 'System Name', {
      columnData: hosts.map((host) => (
        <a key={host.id} href="#">
          {host.display_name}
        </a>
      )),
    });
  },

  'all-cves': (_e, cvePromises: ReturnType<typeof getHostCVEs>[]) => {
    return new InventoryColumn('all-cves', 'Total CVEs', {
      columnData: async () => {
        const res = await Promise.all(cvePromises);
        return res.map((r, index) => (
          <a key={index} href="#">
            {r.allCount}
          </a>
        ));
      },
    });
  },

  cves: (_e, cvePromises: ReturnType<typeof getHostCVEs>[]) => {
    return new InventoryColumn('cves', 'High severity CVEs', {
      columnData: async () => {
        const res = await Promise.all(cvePromises);
        return res.map((r, index) => {
          return (
            <>
              <span key={index} className="pf-v5-u-mr-md">
                <Icon status="danger" className="pf-v5-u-mr-sm">
                  <SecurityIcon />
                </Icon>
                <a href="#">{r.criticalCount}</a>
              </span>
              <span>
                <Icon status="warning" className="pf-v5-u-mr-sm">
                  <SecurityIcon />
                </Icon>
                <a href="#">{r.highCount}</a>
              </span>
            </>
          );
        });
      },
    });
  },

  tags: (hosts: Host[]) =>
    new InventoryColumn('tags', 'Tags??', {
      columnData: async () => {
        const promises = hosts.map((host) => {
          if (!host.id) {
            return { count: 0, results: {} };
          }
          return getHostTags(host.id);
        });
        const res = await Promise.all(promises);
        return res.map((r, index) => {
          const tagCount = Object.values(r.results).reduce((acc, curr) => acc + curr, 0);
          return (
            <span key={index}>
              <TagIcon className="pf-v5-u-mr-md" />
              {tagCount}
            </span>
          );
        });
      },
    }),

  os: (hosts: Host[]) => {
    return new BaseInventoryColumn('os', 'OS', {
      columnData: hosts.map((host) =>
        host.system_profile.operating_system ? (
          <span key={host.id}>
            {host.system_profile.operating_system.name}&nbsp;
            {host.system_profile.operating_system.major}.{host.system_profile.operating_system.minor}
          </span>
        ) : (
          'Not available'
        )
      ),
    });
  },

  lastCheckIn: (hosts: Host[]) => {
    return new BaseInventoryColumn('lastCheckIn', 'Last check-in', {
      columnData: hosts.map((host) =>
        host.per_reporter_staleness.puptoo?.last_check_in ? (
          <DateFormat key={host.id} date={host.per_reporter_staleness.puptoo?.last_check_in} />
        ) : null
      ),
    });
  },
};

const ModularInventoryRoute = () => {
  const [hosts, setHosts] = React.useState<Host[]>([]);
  const [enabledColumns, setEnabledColumns] = useState(
    columnIds.reduce<{ [key: string]: boolean }>((acc, curr) => {
      acc[curr] = true;
      return acc;
    }, {})
  );

  const handleCheckboxChange = (columnId: string) => {
    setEnabledColumns((prev) => ({
      ...prev,
      [columnId]: !prev[columnId],
    }));
  };
  const cols = useMemo(() => {
    const cvePromises = hosts.map((host) => {
      if (!host.id) {
        return { criticalCount: 0, highCount: 0, allCount: 0 };
      }
      return getHostCVEs(host.id);
    });

    const cols = columnIds
      .filter((columnId) => enabledColumns[columnId])
      .map((columnId) => {
        return columnsRegistry[columnId](hosts, cvePromises as any);
      });

    return cols;
  }, [hosts, enabledColumns]);

  async function initData() {
    const response = await getHosts();
    setHosts(response.results);
    getHostTags(response.results[0].insights_id);
  }

  useEffect(() => {
    initData();
  }, []);

  return (
    <div className="pf-v5-u-p-md">
      <ColumnEnabler enabledColumns={enabledColumns} handleCheckboxChange={handleCheckboxChange} />
      <ModularInventory columns={cols} />
    </div>
  );
};

export default ModularInventoryRoute;
