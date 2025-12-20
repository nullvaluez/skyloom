'use client';

import { memo } from 'react';
import { Crosshair, Copy, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const ActionButtons = memo(function ActionButtons({ 
  isFollowing, 
  onFollow, 
  onCopy, 
  onShare 
}) {
  return (
    <div className="flex gap-2">
      <Button
        variant={isFollowing ? 'default' : 'outline'}
        size="default"
        className="flex-1 h-11"
        onClick={onFollow}
      >
        <Crosshair className="h-4 w-4 mr-2" />
        {isFollowing ? 'Following' : 'Follow'}
      </Button>
      <Button
        variant="outline"
        size="default"
        className="h-11 w-11"
        onClick={onCopy}
        title="Copy flight info"
      >
        <Copy className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="default"
        className="h-11 w-11"
        onClick={onShare}
        title="Share flight"
      >
        <Share2 className="h-4 w-4" />
      </Button>
    </div>
  );
});
