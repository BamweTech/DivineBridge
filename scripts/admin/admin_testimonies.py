#!/usr/bin/env python3
"""
Admin tool for managing testimonies
Run this script to review and approve/reject pending testimonies
"""

import sys
from backend.integrations.storage_handler import StorageHandler
from datetime import datetime

def main():
    """Main admin interface for testimony management"""
    storage = StorageHandler()
    
    print("\n" + "="*60)
    print("🙏 DIVINE BRIDGE - Testimony Admin Tool")
    print("="*60 + "\n")
    
    # Get all testimonies
    all_testimonies = storage.get_all_testimonies(limit=100)
    pending = [t for t in all_testimonies if not t.get('approved', False) and not t.get('rejected', False)]
    approved = [t for t in all_testimonies if t.get('approved', False)]
    rejected = [t for t in all_testimonies if t.get('rejected', False)]
    
    print(f"📊 Status:")
    print(f"   ✅ Approved: {len(approved)}")
    print(f"   ⏳ Pending: {len(pending)}")
    print(f"   ❌ Rejected: {len(rejected)}")
    print(f"   📖 Total: {len(all_testimonies)}\n")
    
    if len(pending) == 0:
        print("✨ No pending testimonies to review!\n")
        return
    
    print(f"{'='*60}")
    print(f"PENDING TESTIMONIES ({len(pending)})")
    print(f"{'='*60}\n")
    
    for i, testimony in enumerate(pending, 1):
        print(f"\n{'─'*60}")
        print(f"#{i} - {testimony.get('title', 'Untitled')}")
        print(f"{'─'*60}")
        print(f"ID: {testimony.get('id')}")
        print(f"Submitted: {testimony.get('created_at', 'Unknown')[:19]}")
        print(f"\nContent:")
        print(f"{testimony.get('content', 'No content')}\n")
        
        # Ask for action
        while True:
            action = input(f"Action [A]pprove / [R]eject / [S]kip / [Q]uit: ").strip().upper()
            
            if action == 'A':
                # Approve
                testimony['approved'] = True
                testimony['approved_at'] = datetime.now().isoformat()
                storage.update_testimony(testimony.get('id'), testimony)
                print(f"✅ APPROVED: {testimony.get('title')}\n")
                break
            
            elif action == 'R':
                # Reject with reason
                reason = input("Rejection reason (optional): ").strip()
                testimony['approved'] = False
                testimony['rejected'] = True
                testimony['rejected_at'] = datetime.now().isoformat()
                testimony['rejection_reason'] = reason or 'Not specified'
                storage.update_testimony(testimony.get('id'), testimony)
                print(f"❌ REJECTED: {testimony.get('title')}\n")
                break
            
            elif action == 'S':
                print(f"⏭️  SKIPPED\n")
                break
            
            elif action == 'Q':
                print("\n👋 Exiting admin tool...\n")
                return
            
            else:
                print("Invalid action. Please choose A, R, S, or Q.")
    
    print(f"\n{'='*60}")
    print("✅ Review complete!")
    print(f"{'='*60}\n")
    
    # Show final stats
    all_testimonies = storage.get_all_testimonies(limit=100)
    pending_after = [t for t in all_testimonies if not t.get('approved', False) and not t.get('rejected', False)]
    approved_after = [t for t in all_testimonies if t.get('approved', False)]
    
    print(f"📊 Updated Status:")
    print(f"   ✅ Approved: {len(approved_after)}")
    print(f"   ⏳ Pending: {len(pending_after)}")
    print("")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n👋 Admin tool interrupted. Goodbye!\n")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}\n")
        sys.exit(1)

