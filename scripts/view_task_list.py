#!/usr/bin/env python3
"""
Script to view task lists from Firestore
Usage: python scripts/view_task_list.py [task_list_id]
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from google.cloud import firestore
from firebase_auth import get_firestore_client
import json

def view_task_list(task_list_id=None):
    """View a specific task list or list all task lists"""
    db = get_firestore_client()
    
    if task_list_id:
        # View specific task list
        print(f"\n📋 Fetching task list: {task_list_id}\n")
        task_list_doc = db.collection('daily_task_lists').document(task_list_id).get()
        
        if not task_list_doc.exists:
            print(f"❌ Task list {task_list_id} not found")
            return
        
        data = task_list_doc.to_dict()
        print(f"Date: {data.get('date')}")
        print(f"Generated At: {data.get('generated_at')}")
        print(f"Total Tasks: {len(data.get('task_list', []))}")
        print(f"Admin Tasks: {data.get('admin_tasks_count', 0)}")
        print(f"Errors: {data.get('errors_count', 0)}")
        print(f"Warnings: {data.get('warnings_count', 0)}")
        
        print(f"\n{'='*80}")
        print(f"TASK LIST ({len(data.get('task_list', []))} tasks)")
        print(f"{'='*80}\n")
        
        # Group by priority
        high_priority = [t for t in data.get('task_list', []) if t.get('priority') == 'high']
        medium_priority = [t for t in data.get('task_list', []) if t.get('priority') == 'medium']
        low_priority = [t for t in data.get('task_list', []) if t.get('priority') == 'low']
        
        if high_priority:
            print(f"🔴 HIGH PRIORITY ({len(high_priority)} tasks):")
            print("-" * 80)
            for i, task in enumerate(high_priority, 1):
                print(f"{i}. [{task.get('type', 'task').upper()}] {task.get('description', '')[:120]}")
                print(f"   Source: {task.get('source', 'Unknown')}")
                if task.get('category'):
                    print(f"   Category: {task.get('category')}")
                print()
        
        if medium_priority:
            print(f"\n🟡 MEDIUM PRIORITY ({len(medium_priority)} tasks):")
            print("-" * 80)
            for i, task in enumerate(medium_priority, 1):
                print(f"{i}. [{task.get('type', 'task').upper()}] {task.get('description', '')[:120]}")
                print(f"   Source: {task.get('source', 'Unknown')}")
                print()
        
        if low_priority:
            print(f"\n🟢 LOW PRIORITY ({len(low_priority)} tasks):")
            print("-" * 80)
            for i, task in enumerate(low_priority, 1):
                print(f"{i}. [{task.get('type', 'task').upper()}] {task.get('description', '')[:120]}")
                print(f"   Source: {task.get('source', 'Unknown')}")
                print()
        
    else:
        # List all task lists
        print("\n📋 All Daily Task Lists:\n")
        task_lists = db.collection('daily_task_lists')\
            .order_by('generated_at', direction=firestore.Query.DESCENDING)\
            .limit(10)\
            .stream()
        
        for doc in task_lists:
            data = doc.to_dict()
            print(f"ID: {doc.id}")
            print(f"  Date: {data.get('date')}")
            print(f"  Generated: {data.get('generated_at')}")
            print(f"  Tasks: {len(data.get('task_list', []))} (Admin: {data.get('admin_tasks_count', 0)}, Errors: {data.get('errors_count', 0)}, Warnings: {data.get('warnings_count', 0)})")
            print()

if __name__ == '__main__':
    task_list_id = sys.argv[1] if len(sys.argv) > 1 else None
    view_task_list(task_list_id)

