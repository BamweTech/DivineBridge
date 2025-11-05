#!/usr/bin/env python3
"""
Create a formatted to-do list from the daily task list
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from google.cloud import firestore
from firebase_auth import get_firestore_client
from datetime import datetime

def create_todo_list(task_list_id='3XfEBQYmothZFlJzdOni'):
    """Create a formatted to-do list from the task list"""
    db = get_firestore_client()
    
    print(f"\n📋 Retrieving task list: {task_list_id}\n")
    task_list_doc = db.collection('daily_task_lists').document(task_list_id).get()
    
    if not task_list_doc.exists:
        print(f"❌ Task list {task_list_id} not found")
        return
    
    data = task_list_doc.to_dict()
    task_list = data.get('task_list', [])
    
    print("=" * 100)
    print(f"📅 DAILY TASK LIST - {data.get('date')}")
    print(f"Generated: {data.get('generated_at')}")
    print(f"Total Tasks: {len(task_list)} | Admin Tasks: {data.get('admin_tasks_count', 0)} | Errors: {data.get('errors_count', 0)} | Warnings: {data.get('warnings_count', 0)}")
    print("=" * 100)
    print()
    
    # Group by priority
    high_priority = [t for t in task_list if t.get('priority') == 'high']
    medium_priority = [t for t in task_list if t.get('priority') == 'medium']
    low_priority = [t for t in task_list if t.get('priority') == 'low']
    
    # Create markdown-style to-do list
    print("## 🔴 HIGH PRIORITY TASKS")
    print()
    for i, task in enumerate(high_priority, 1):
        task_type = task.get('type', 'task')
        description = task.get('description', '')
        source = task.get('source', 'Unknown')
        category = task.get('category', '')
        
        print(f"### Task {i}: {task_type.upper()}")
        print(f"- [ ] {description}")
        if category:
            print(f"  - Category: {category}")
        print(f"  - Source: {source}")
        if task.get('error_details'):
            error = task['error_details']
            print(f"  - Severity: {error.get('severity', 'ERROR')}")
            if error.get('timestamp'):
                print(f"  - Time: {error.get('timestamp')}")
        print()
    
    if medium_priority:
        print("## 🟡 MEDIUM PRIORITY TASKS")
        print()
        for i, task in enumerate(medium_priority, 1):
            task_type = task.get('type', 'task')
            description = task.get('description', '')
            source = task.get('source', 'Unknown')
            
            print(f"### Task {len(high_priority) + i}: {task_type.upper()}")
            print(f"- [ ] {description}")
            print(f"  - Source: {source}")
            if task.get('pattern'):
                print(f"  - Pattern: {task.get('pattern')} ({task.get('occurrences')} occurrences)")
            print()
    
    if low_priority:
        print("## 🟢 LOW PRIORITY TASKS")
        print()
        for i, task in enumerate(low_priority, 1):
            task_type = task.get('type', 'task')
            description = task.get('description', '')
            source = task.get('source', 'Unknown')
            
            print(f"### Task {len(high_priority) + len(medium_priority) + i}: {task_type.upper()}")
            print(f"- [ ] {description}")
            print(f"  - Source: {source}")
            print()
    
    # Summary by category
    print("---")
    print("## 📊 SUMMARY BY CATEGORY")
    print()
    
    categories = {}
    for task in task_list:
        cat = task.get('category', 'general')
        if cat not in categories:
            categories[cat] = {'high': 0, 'medium': 0, 'low': 0, 'total': 0}
        priority = task.get('priority', 'medium')
        categories[cat][priority] = categories[cat].get(priority, 0) + 1
        categories[cat]['total'] += 1
    
    for cat, counts in sorted(categories.items(), key=lambda x: x[1]['total'], reverse=True):
        print(f"- **{cat.title()}**: {counts['total']} tasks ({counts['high']} high, {counts['medium']} medium, {counts['low']} low)")
    
    print()
    print("=" * 100)
    
    # Save to file
    output_file = f"todo_list_{data.get('date', 'latest')}.md"
    with open(output_file, 'w') as f:
        f.write(f"# Daily Task List - {data.get('date')}\n\n")
        f.write(f"Generated: {data.get('generated_at')}\n\n")
        f.write(f"**Total Tasks:** {len(task_list)} | **Admin Tasks:** {data.get('admin_tasks_count', 0)} | **Errors:** {data.get('errors_count', 0)} | **Warnings:** {data.get('warnings_count', 0)}\n\n")
        f.write("---\n\n")
        
        f.write("## 🔴 HIGH PRIORITY TASKS\n\n")
        for i, task in enumerate(high_priority, 1):
            f.write(f"### Task {i}: {task.get('type', 'task').upper()}\n")
            f.write(f"- [ ] {task.get('description', '')}\n")
            if task.get('category'):
                f.write(f"  - Category: {task.get('category')}\n")
            f.write(f"  - Source: {task.get('source', 'Unknown')}\n\n")
        
        if medium_priority:
            f.write("## 🟡 MEDIUM PRIORITY TASKS\n\n")
            for i, task in enumerate(medium_priority, 1):
                f.write(f"### Task {len(high_priority) + i}: {task.get('type', 'task').upper()}\n")
                f.write(f"- [ ] {task.get('description', '')}\n")
                f.write(f"  - Source: {task.get('source', 'Unknown')}\n\n")
        
        if low_priority:
            f.write("## 🟢 LOW PRIORITY TASKS\n\n")
            for i, task in enumerate(low_priority, 1):
                f.write(f"### Task {len(high_priority) + len(medium_priority) + i}: {task.get('type', 'task').upper()}\n")
                f.write(f"- [ ] {task.get('description', '')}\n")
                f.write(f"  - Source: {task.get('source', 'Unknown')}\n\n")
    
    print(f"✅ To-do list saved to: {output_file}")
    print()

if __name__ == '__main__':
    task_list_id = sys.argv[1] if len(sys.argv) > 1 else '3XfEBQYmothZFlJzdOni'
    create_todo_list(task_list_id)

