'use client';

import { memo } from 'react';
import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatTimeSince } from '@/lib/format';

export const DataSourceInfo = memo(function DataSourceInfo({ aircraft, dataSource }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Data Source
      </h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Source</span>
          <Badge variant="outline" className="text-[10px] h-5">{dataSource?.toUpperCase()}</Badge>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Messages</span>
          <span>{aircraft.messages?.toLocaleString() || 'N/A'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Last Seen</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimeSince(aircraft.seen)}
          </span>
        </div>
      </div>
    </div>
  );
});
