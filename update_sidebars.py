import os
import re

files = ['resources.html', 'profile.html', 'admin.html', 'index.html']
for filename in files:
    if not os.path.exists(filename):
        continue
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()

    new_content = content
    if 'href="calls.html"' not in content:
        if '<a href="resources.html"' in content:
            parts = new_content.split('<a href="resources.html"')
            if len(parts) == 2:
                if '<span>Resources</span>' in content:
                    inserted = '<a href="calls.html" id="callsNavLink"><i class="fas fa-phone"></i> <span>Call Logs</span></a>\n      '
                else:
                    inserted = '<a href="calls.html"><i class="fas fa-phone"></i> Call Logs</a>\n      '
                new_content = parts[0] + inserted + '<a href="resources.html"' + parts[1]
                
                with open(filename, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Updated {filename}")
        elif '<a href="resources.html">' in content:
            pass # Handle other cases if needed
