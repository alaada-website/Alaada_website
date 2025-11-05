'''

This software has been developed by Arzo Das, a passionate and innovative developer dedicated to creating tools that empower users through intuitive design and powerful functionality.
Published under the banner of Alaada, this application embodies the organization's commitment to excellence in digital solutions.
With a vision rooted in simplicity, accuracy, and user-centric development, Alaada is proud to present this spreadsheet program as a cornerstone of smart business tools.
ALAADA – Where Precision Meets Possibility

------------------------------------------------------------
                    SOFTWARE LICENSE AGREEMENT
                   For "ALAADA" by Arzo Das, Alaada
         Tagline: ALAADA – Where Precision Meets Possibility
------------------------------------------------------------

IMPORTANT - READ CAREFULLY: This End-User License Agreement (“Agreement”) is a legal agreement between you (either an individual or a single entity) and Alaada, the developer and publisher of the software product "ALAADA", developed by Arzo Das.

By installing, copying, accessing, or otherwise using ALAADA, you agree to be bound by the terms of this License Agreement. If you do not agree to the terms of this Agreement, do not install or use ALAADA.

------------------------------------------------------------
1. GRANT OF LICENSE
------------------------------------------------------------
Alaada grants you a non-exclusive, non-transferable, revocable license to install and use ALAADA solely for your personal, educational, or internal business purposes, subject to the terms set forth herein.

You may:
- Install and use ALAADA on one or more computers you own or control.
- Create backups of the software for archival purposes.
- Use all features as provided in the licensed version.

You may not:
- Distribute, sell, rent, lease, sublicense, or otherwise transfer copies of the software to others without express written consent from Alaada.
- Reverse engineer, decompile, disassemble, modify, or create derivative works based on ALAADA or any part thereof.
- Use the software in any unlawful or harmful way, or to develop competing software.

------------------------------------------------------------
2. OWNERSHIP AND COPYRIGHT
------------------------------------------------------------
ALAADA is licensed, not sold. All rights, titles, and intellectual property in and to ALAADA, including but not limited to design, features, source code, documentation, and logos, are the exclusive property of Arzo Das and Alaada.

All rights not expressly granted in this License are reserved by Alaada.

------------------------------------------------------------
3. USAGE RESTRICTIONS
------------------------------------------------------------
You agree not to:
- Copy, reproduce, or distribute the software except as expressly permitted.
- Circumvent any encryption or security mechanisms.
- Use the software in high-risk environments where failure could result in significant harm.
- Use the software for any purpose that violates laws or regulations.

------------------------------------------------------------
4. DISCLAIMER OF WARRANTIES
------------------------------------------------------------
THE SOFTWARE IS PROVIDED “AS IS” AND WITHOUT WARRANTY OF ANY KIND. ALAADA, ARZO DAS, AND ALAADA MAKE NO WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.

YOUR USE OF THE SOFTWARE IS AT YOUR OWN RISK.

------------------------------------------------------------
5. LIMITATION OF LIABILITY
------------------------------------------------------------
IN NO EVENT SHALL ALAADA, ARZO DAS, OR ITS AFFILIATES BE LIABLE FOR ANY INDIRECT, SPECIAL, INCIDENTAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS OR DATA, ARISING OUT OF THE USE OR INABILITY TO USE ALAADA, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

IN NO EVENT WILL LIABILITY EXCEED THE AMOUNT PAID FOR THE SOFTWARE, IF ANY.

------------------------------------------------------------
6. TERMINATION
------------------------------------------------------------
This License Agreement is effective until terminated. It will terminate automatically without notice if you fail to comply with any of its terms.

Upon termination:
- You must cease all use of ALADA.
- All copies in your possession must be destroyed.

------------------------------------------------------------
7. GOVERNING LAW
------------------------------------------------------------
This Agreement shall be governed by and construed in accordance with the laws of the jurisdiction in which the developer resides, without regard to conflict of law principles.

Any disputes arising under or in connection with this Agreement shall be subject to the exclusive jurisdiction of the courts of the developer’s location.

------------------------------------------------------------
8. ENTIRE AGREEMENT
------------------------------------------------------------
This Agreement constitutes the entire agreement between you and Alaada with respect to the software and supersedes all prior or contemporaneous understandings.

If any provision is found to be unenforceable, it shall be enforced to the maximum extent permissible and the remainder shall remain in full force.

------------------------------------------------------------
THANK YOU
------------------------------------------------------------
Thank you for using ALAADA – Where Precision Meets Possibility.

© 2025 Alada. All rights reserved.
Developed and published by Arzo Das.
“ALAADA” and its logo are trademarks of Arzo Das.

Unauthorized reproduction or distribution of this software is strictly prohibited.

'''
import time
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, colorchooser, simpledialog
import pandas as pd
import numpy as np
import re
import matplotlib.pyplot as plt
from tksheet import Sheet
import math
import openai
import os
import chardet
import logging
import json
from pathlib import Path

RECENT_FILE_PATH = Path("recent_files.json")
def get_api_key():
    api_key = os.getenv()
    if not api_key:
        messagebox.showwarning("API Key Missing", "OpenAI API key not set. Please set it from Smart AI > Set API Key.")
    else:
        openai.api_key = api_key


FUNCTION_LIST = ["SUM", "AVG", "MAX", "MIN", "COUNT", "ABS", "ROUND", "SQRT", "ADD", "SUB", "MUL", "DIV"]

# Core mathematical functions
def add(x, y): return x + y
def subtract(x, y): return x - y
def multiply(x, y): return x * y
def divide(x, y): return x / y if y != 0 else float('inf')
def square_root(x): return math.sqrt(x)
def round_value(x, digits=0): return round(x, digits)
def absolute(x): return abs(x)
def count_args(*args): return len(args)
def average(*args): return sum(args) / len(args) if args else 0
def maximum(*args): return max(args)
def minimum(*args): return min(args)

# Configure logging to file
logging.basicConfig(
    filename="alaada_app.log",            # Log file name
    level=logging.INFO,                  # Minimum level to log (INFO, DEBUG, ERROR, etc.)
    format='%(asctime)s - %(levelname)s - %(message)s',  # Log format
    filemode='a'                         # Append mode
)

# Calculator Frame (Now always visible)
class CalculatorWindow:
    def __init__(self, parent, get_cell_value_callback):
        self.parent = parent
        self.get_cell_value = get_cell_value_callback
        self.window = None
        self.history = []
        self.expression = tk.StringVar()

    def open(self):
        """Open the calculator as a separate window (singleton style)."""
        if self.window and tk.Toplevel.winfo_exists(self.window):
            self.window.lift()
            self.window.focus_force()
            return

        self.window = tk.Toplevel(self.parent)
        self.window.title("Alaada Calculator")
        self.window.geometry("250x340")
        self.window.resizable(False, False)
        self.window.protocol("WM_DELETE_WINDOW", self.close)

        # --- Entry field ---
        entry = tk.Entry(
            self.window,
            textvariable=self.expression,
            font=('Arial', 12),
            bd=6,
            relief=tk.RIDGE,
            justify='right'
        )
        entry.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # --- Button frame ---
        btn_frame = tk.Frame(self.window)
        btn_frame.pack(expand=True, fill="both")

        buttons = [
            ('7', '8', '9', '/'),
            ('4', '5', '6', '*'),
            ('1', '2', '3', '-'),
            ('0', '.', '=', '+')
        ]

        def click(btn):
            if btn == "=":
                try:
                    expr = self.replace_cell_refs(self.expression.get())
                    result = eval(expr)
                    self.history.append(f"{self.expression.get()} = {result}")
                    self.expression.set(result)
                except Exception:
                    self.expression.set("Error")
            else:
                self.expression.set(self.expression.get() + btn)

        for row in buttons:
            row_frame = tk.Frame(btn_frame)
            row_frame.pack(expand=True, fill="both")
            for btn in row:
                b = tk.Button(
                    row_frame,
                    text=btn,
                    font=('Arial', 12),
                    relief=tk.GROOVE,
                    command=lambda b=btn: click(b)
                )
                b.pack(side=tk.LEFT, expand=True, fill="both")

        # --- History button ---
        history_button = tk.Button(
            self.window,
            text="History",
            font=('Arial', 10),
            command=self.show_history
        )
        history_button.pack(side=tk.BOTTOM, fill=tk.X)

    def replace_cell_refs(self, expr):
        import re
        return re.sub(
            r"([A-Za-z])([0-9]+)",
            lambda m: str(self.parent.get_cell_value(int(m.group(2)) - 1, ord(m.group(1).upper()) - 65)),
            expr
        )

    def show_history(self):
        """Show calculator operation history."""
        history_window = tk.Toplevel(self.window)
        history_window.title("Calculator History")
        text = tk.Text(history_window, wrap=tk.WORD)
        text.pack(expand=True, fill="both")
        text.insert(tk.END, "\n".join(self.history))
        text.config(state=tk.DISABLED)

    def close(self):
        """Safely close the calculator window."""
        if self.window:
            self.window.destroy()
            self.window = None

    def update_for_new_sheet(self):
        """Optional: called when a new sheet is opened."""
        if self.window and tk.Toplevel.winfo_exists(self.window):
            self.window.title("Alaada Calculator — Updated Sheet")


# Spreadsheet Application
def safe_read_file(filepath):
    """Read any text or binary file safely and return decoded text."""
    try:
        with open(filepath, "rb") as raw:
            raw_bytes = raw.read()
            detected = chardet.detect(raw_bytes)
            enc = detected.get("encoding") or "utf-8"
            logging.info(f"Detected encoding for {filepath}: {enc}")
            return raw_bytes.decode(enc, errors="replace")
    except Exception as e:
        logging.exception(f"Failed to read file safely: {e}")
        return ""


class SpreadsheetApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Alaada Spreadsheets")

        self.autosave_interval = 300000  # 5 minutes
        self.autosave_file = "autosave.als"
        self.root.after(self.autosave_interval, self.autosave)

        self.recent_files = self.load_recent_files()
        self.calculator = CalculatorWindow(self.root, self.get_cell_value)

        self.current_cell_row = None
        self.current_cell_col = None

        # Menu bar with License option
        menubar = tk.Menu(root)
        root.config(menu=menubar)
        help_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Help", menu=help_menu)
        help_menu.add_command(label="License Agreement", command=self.show_license)
        # Main horizontal paned layout
        self.paned = tk.PanedWindow(root, orient=tk.HORIZONTAL)
        self.paned.pack(fill="both", expand=True)

        self.sheet_frame = tk.Frame(self.paned)
        self.sheet_frame.pack(expand=True, fill="both")
        self.notebook = ttk.Notebook(self.sheet_frame)
        self.notebook.pack(expand=1, fill="both")
        self.paned.add(self.sheet_frame, stretch="always")

        # Create Tools menu if not already defined
        tools_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Tools", menu=tools_menu)

        # Add Calculator option to Tools menu
        tools_menu.add_command(label="Calculator", command=self.calculator.open)

        self.user_functions = {
            "SUM": lambda *args: sum(args),
            "AVG": average,
            "MAX": maximum,
            "MIN": minimum,
            "COUNT": count_args,
            "ABS": absolute,
            "ROUND": round_value,
            "SQRT": square_root,
            "ADD": add,
            "SUB": subtract,
            "MUL": multiply,
            "DIV": divide
        }
        self.sheets = {}
        self.undo_stacks = {}
        self.redo_stacks = {}

        self.add_new_sheet()
        self.setup_menu()
        self.setup_shortcuts()

        user_file = "user_info.txt"
        if not os.path.exists(user_file):
            user_name = simpledialog.askstring("Welcome to ALAADA", "Please enter your name:")
            if user_name:
                with open(user_file, "w") as f:
                    f.write(user_name)
                logging.info(f"New user: {user_name}")
            else:
                user_name = "User"
        else:
            with open(user_file, "r") as f:
                user_name = f.read().strip()

        # Show personalized welcome
        welcome_message = f"Welcome back, {user_name}!\nThank you for using ALAADA – Where Precision Meets Possibility."
        messagebox.showinfo("Welcome", welcome_message)
        logging.info(f"Displayed welcome message for {user_name}.")

        # Show license agreement on first run
        self.show_license()
        # Confirm on close
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)


    def show_license(self):
        license_text = """
SOFTWARE LICENSE AGREEMENT
For \"ALAADA\" by Arzo Das, Alaada
Tagline: ALAADA – Where Precision Meets Possibility

IMPORTANT - READ CAREFULLY: This End-User License Agreement (“Agreement”) is a legal agreement between you (either an individual or a single entity) and Alaada.

By installing, copying, accessing, or otherwise using ALAADA, you agree to be bound by the terms of this License Agreement.

1. GRANT OF LICENSE
- Install and use on your own devices.
- You may NOT distribute, reverse-engineer, sublicense, or use unlawfully.

2. OWNERSHIP AND COPYRIGHT
- ALAADA is owned by Arzo Das and Alaada.

3. DISCLAIMER OF WARRANTIES
- Provided \"AS IS\" without warranties.

4. LIMITATION OF LIABILITY
- We are not liable for damages resulting from use.

5. TERMINATION
- We may terminate your license if violated.

6. GOVERNING LAW
- Governed by laws of the developer's location.

Thank you for using ALAADA.
© 2025 Alaada. All rights reserved.
"""
        license_window = tk.Toplevel(self.root)
        license_window.title("License Agreement")
        text = tk.Text(license_window, wrap=tk.WORD)
        text.pack(expand=True, fill="both")
        text.insert(tk.END, license_text)
        text.config(state=tk.DISABLED)

    def get_active_sheet_data(self):
        sheet = self.get_active_sheet()
        return sheet.get_sheet_data() if sheet else {}
    import time
    def autosave(self):
        """Automatically save the active sheet every few minutes."""
        try:
            data = self.get_active_sheet_data()
            with open(self.autosave_file, "w", encoding="utf-8") as f:
                json.dump(data, f)
            print(f"[AutoSave] {time.strftime('%H:%M:%S')} → {self.autosave_file}")
        except Exception as e:
            print(f"[AutoSave Error] {e}")
        finally:
            self.root.after(self.autosave_interval, self.autosave)

    def recover_autosave(self):
        """Offer to recover autosave data on startup."""
        if os.path.exists(self.autosave_file):
            if messagebox.askyesno("Recover File", "Autosave found.\nRecover it?"):
                with open(self.autosave_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.get_active_sheet().load_sheet_data(data)
                messagebox.showinfo("Recovered", "Autosave recovered successfully.")

    def add_1000_rows(self):
        sheet = self.get_active_sheet()
        data = sheet.get_sheet_data()
        num_cols = sheet.total_columns()

        # Add 1000 empty rows
        for _ in range(1000):
            data.append([""] * num_cols)

        sheet.set_sheet_data(data)

    def add_1000_columns(self):
        sheet = self.get_active_sheet()
        data = sheet.get_sheet_data()

        # Add 1000 empty columns to each row
        for row in data:
            row.extend([""] * 1000)

        sheet.set_sheet_data(data)

    def build_formula_bar(self):
        frame = ttk.Frame(self.root, padding=4)
        frame.pack(fill="x")

        ttk.Label(frame, text="fx", width=2).pack(side="left")
        self.formula_var = tk.StringVar()
        entry = ttk.Entry(frame, textvariable=self.formula_var)
        entry.pack(side="left", fill="x", expand=True)
        entry.bind("<Return>", lambda e: self.apply_formula())

        self.formula_bar = entry

    def on_cell_select(self, cell_ref, value):
        """Update formula bar when cell is selected."""
        self.formula_var.set(value)
        self.status_var.set(f"Cell {cell_ref}")

    def apply_formula(self):
        """Apply formula bar text to active cell."""
        value = self.formula_var.get()
        self.active_sheet.set_active_cell_value(value)

    def add_rows_dynamic(self):
        sheet = self.get_active_sheet()
        try:
            n = simpledialog.askinteger("Add Rows", "How many rows to add?", minvalue=1, maxvalue=100000)
            if n:
                data = sheet.get_sheet_data()
                num_cols = sheet.total_columns()
                for _ in range(n):
                    data.append([""] * num_cols)
                sheet.set_sheet_data(data)
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def build_status_bar(self):
        frame = ttk.Frame(self.root, relief="sunken", padding=2)
        frame.pack(side="bottom", fill="x")

        self.status_var = tk.StringVar(value="Ready")
        self.autosave_var = tk.StringVar(value="Autosave: On")

        ttk.Label(frame, textvariable=self.status_var).pack(side="left", padx=10)
        ttk.Label(frame, textvariable=self.autosave_var).pack(side="right", padx=10)

        self.status_bar = frame

    def toggle_theme(self):
        if getattr(self, "dark_mode", False):
            self.root.configure(bg="white")
            style = ttk.Style()
            style.configure("TFrame", background="white", foreground="black")
            self.dark_mode = False
        else:
            self.root.configure(bg="#1e1e1e")
            style = ttk.Style()
            style.configure("TFrame", background="#1e1e1e", foreground="white")
            self.dark_mode = True

    def add_columns_dynamic(self):
        sheet = self.get_active_sheet()
        try:
            n = simpledialog.askinteger("Add Columns", "How many columns to add?", minvalue=1, maxvalue=100000)
            if n:
                data = sheet.get_sheet_data()
                for row in data:
                    row.extend([""] * n)
                sheet.set_sheet_data(data)
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def on_closing(self):
        if messagebox.askokcancel("Quit", "Do you really want to exit ALAADA?"):
            logging.info("Application closed by user.")
            self.root.destroy()
        else:
            logging.info("Exit canceled by user.")

    def get_cell_value(self, col_letter, row_number):
        """
        Return the value of a given cell, e.g. ('A', 1) -> sheet cell value.
        Used by the calculator for formulas like A1 + B2.
        """
        sheet = self.get_active_sheet()
        if not sheet:
            return 0

        try:
            # Convert column letter (A, B, C...) to 0-based index
            col_index = ord(col_letter.upper()) - ord('A')
            row_index = row_number - 1  # 1-based to 0-based

            # Depending on your sheet structure, adjust this:
            if hasattr(sheet, "get_cell_data"):
                value = sheet.get_cell_data(row_index, col_index)
            elif isinstance(sheet, dict) and "data" in sheet:
                value = sheet["data"].get((row_index, col_index), "")
            else:
                value = ""

            # Clean the value
            if value in ("", None, "NaN", "nan"):
                return 0
            return float(value) if str(value).replace('.', '', 1).isdigit() else value
        except Exception:
            return 0

    def safe_read_file(filepath):
        """Read any text or binary file safely and return decoded text."""
        try:
            with open(filepath, "rb") as raw:
                raw_bytes = raw.read()
                detected = chardet.detect(raw_bytes)
                enc = detected.get("encoding") or "utf-8"
                logging.info(f"Detected encoding for {filepath}: {enc}")
                return raw_bytes.decode(enc, errors="replace")
        except Exception as e:
            logging.exception(f"Failed to read file safely: {e}")
            return ""

    def load_recent_files(self):
        if RECENT_FILE_PATH.exists():
            try:
                with open(RECENT_FILE_PATH, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logging.warning(f"Failed to load recent files: {e}")
        return []

    def save_recent_files(self):
        try:
            with open(RECENT_FILE_PATH, "w") as f:
                json.dump(self.recent_files[:10], f)  # keep last 10
        except Exception:
            pass

    def add_to_recent(self, filepath):
        if filepath in self.recent_files:
            self.recent_files.remove(filepath)
        self.recent_files.insert(0, filepath)
        self.recent_files = self.recent_files[:10]
        self.save_recent_files()
        self.refresh_recent_menu()

    def add_new_sheet_tab(self, name="New Sheet"):
        """Create a new sheet tab and return its sheet object."""
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text=name)
        sheet = Sheet(frame)
        sheet.enable_bindings()
        self.sheets[frame] = sheet
        self.notebook.select(frame)
        if hasattr(self, "calculator"):
            self.calculator.update_for_new_sheet()
        return sheet

    def open_recent_file(self, filepath):
        """Open a recent spreadsheet in a new sheet tab safely using only os and built-ins."""
        import os
        from tkinter import messagebox

        if not os.path.exists(filepath):
            messagebox.showerror("File Not Found", f"The file '{filepath}' no longer exists.")
            if filepath in self.recent_files:
                self.recent_files.remove(filepath)
                self.save_recent_files()
                self.refresh_recent_menu()
            return

        try:
            # Read the file as bytes, then decode safely (auto UTF-8 fallback)
            with open(filepath, "rb") as f:
                raw = f.read()

            try:
                content = raw.decode("utf-8")
            except UnicodeDecodeError:
                # Fallback to system default (Windows-1252 or similar)
                content = raw.decode("latin-1", errors="replace")

            # Clean the data and split into lines
            lines = [line.strip() for line in content.splitlines() if line.strip()]
            if not lines:
                messagebox.showwarning("Empty File", "The file has no readable data.")
                return

            # Detect the separator automatically
            delimiter = "," if "," in lines[0] else "\t" if "\t" in lines[0] else None
            if delimiter:
                rows = [line.split(delimiter) for line in lines]
            else:
                # If unknown format, treat each line as a single cell in column A
                rows = [[line] for line in lines]

            # Create a new sheet tab
            sheet_name = os.path.basename(filepath)
            sheet = self.add_new_sheet_tab(sheet_name)

            # Populate the cells
            if hasattr(sheet, "set_sheet_data"):
                sheet.set_sheet_data(rows)
            elif hasattr(sheet, "set_cell_data"):
                for r, row in enumerate(rows):
                    for c, val in enumerate(row):
                        sheet.set_cell_data(r, c, val)
            elif hasattr(sheet, "data"):
                sheet.data = rows

            # Add to recent list
            self.add_to_recent(filepath)

            messagebox.showinfo("File Loaded", f"Opened '{sheet_name}' successfully.")
            logging.info(f"Opened {filepath} successfully with pure os-based reader.")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to open file:\n{e}")
            logging.exception(f"Error opening recent file: {filepath}")

    def get_cell_value_by_ref(self, col_letter, row_number):
        sheet = self.get_active_sheet()
        col = ord(col_letter.upper()) - 65
        row = row_number - 1
        try:
            val = sheet.get_cell_data(row, col)
            return float(val) if val else 0
        except Exception as e:
            return 0

    def refresh_recent_menu(self):
        if not hasattr(self, "recent_menu"):
            return
        self.recent_menu.delete(0, tk.END)
        if not self.recent_files:
            self.recent_menu.add_command(label="(No recent files)", state="disabled")
        else:
            for path in self.recent_files:
                label = os.path.basename(path)
                self.recent_menu.add_command(
                    label=label,
                    command=lambda p=path: self.open_recent_file(p)
                )
        self.recent_menu.add_separator()
        self.recent_menu.add_command(label="Clear List", command=self.clear_recent_list)

    def clear_recent_list(self):
        self.recent_files = []
        self.save_recent_files()
        self.refresh_recent_menu()

    def save_als(sheet_data):
        """Save spreadsheet as .als (JSON format)."""
        file_path = filedialog.asksaveasfilename(
            defaultextension=".als",
            filetypes=[("Alaada Spreadsheet", "*.als"), ("All Files", "*.*")]
        )
        if not file_path:
            return

        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(sheet_data, f, indent=4)
            messagebox.showinfo("Saved", f"Spreadsheet saved successfully:\n{file_path}")
        except Exception as e:
            messagebox.showerror("Save Error", f"Error saving file:\n{e}")

    def load_als(self):
        """Load .als file and return its data."""
        file_path = filedialog.askopenfilename(
            filetypes=[("Alaada Spreadsheet", "*.als"), ("All Files", "*.*")]
        )
        if not file_path:
            return None

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            messagebox.showinfo("Loaded", f"Spreadsheet loaded successfully:\n{file_path}")
            return data
        except Exception as e:
            messagebox.showerror("Load Error", f"Error loading file:\n{e}")
            return None

    def setup_menu(self):
        menu = tk.Menu(self.root)
        self.root.config(menu=menu)

        # -------------------- FILE MENU --------------------
        file_menu = tk.Menu(menu, tearoff=0)
        file_menu.add_command(label="New Sheet", command=self.add_new_sheet, accelerator="Ctrl+N")
        file_menu.add_command(label="Open Excel", command=self.load_excel, accelerator="Ctrl+O")
        file_menu.add_command(label="Save Excel", command=self.save_excel, accelerator="Ctrl+S")
        file_menu.add_separator()
        self.recent_menu = tk.Menu(file_menu, tearoff=0)
        file_menu.add_cascade(label="Recent Files", menu=self.recent_menu)
        self.refresh_recent_menu()
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self.root.quit)
        menu.add_cascade(label="File", menu=file_menu)

        # -------------------- EDIT MENU --------------------
        edit_menu = tk.Menu(menu, tearoff=0)
        edit_menu.add_command(label="Undo", command=self.undo, accelerator="Ctrl+Z")
        edit_menu.add_command(label="Redo", command=self.redo, accelerator="Ctrl+Y")
        edit_menu.add_separator()
        edit_menu.add_command(label="Add Row", command=self.add_row)
        edit_menu.add_command(label="Add Column", command=self.add_column)
        edit_menu.add_command(label="Delete Row", command=self.delete_row)
        edit_menu.add_command(label="Delete Column", command=self.delete_column)
        edit_menu.add_separator()
        edit_menu.add_command(label="Add 1000 Rows", command=self.add_1000_rows)
        edit_menu.add_command(label="Add 1000 Columns", command=self.add_1000_columns)
        edit_menu.add_command(label="Add Rows...", command=self.add_rows_dynamic)
        edit_menu.add_command(label="Add Columns...", command=self.add_columns_dynamic)
        menu.add_cascade(label="Edit", menu=edit_menu)

        # -------------------- FORMAT MENU --------------------
        format_menu = tk.Menu(menu, tearoff=0)
        format_menu.add_command(label="Set Cell Background Color", command=self.choose_bg_color)
        format_menu.add_command(label="Set Cell Text Color", command=self.choose_text_color)
        menu.add_cascade(label="Format", menu=format_menu)

        # -------------------- TOOLS MENU --------------------
        tools_menu = tk.Menu(menu, tearoff=0)
        tools_menu.add_command(label="Calculator", command=self.calculator.open)
        tools_menu.add_separator()
        tools_menu.add_command(label="Pivot Table", command=self.create_pivot_table)
        tools_menu.add_command(label="Add Data Validation", command=self.add_data_validation)
        tools_menu.add_command(label="Conditional Formatting", command=self.add_conditional_format_rule)
        menu.add_cascade(label="Tools", menu=tools_menu)

        # -------------------- MACROS & AUTOMATION --------------------
        macro_menu = tk.Menu(menu, tearoff=0)
        macro_menu.add_command(label="Start Recording Macro", command=self.start_macro_recording)
        macro_menu.add_command(label="Stop Recording Macro", command=self.stop_macro_recording)
        macro_menu.add_command(label="Run Macro", command=self.run_macro)
        macro_menu.add_separator()
        macro_menu.add_command(label="Schedule Task", command=self.schedule_task)
        menu.add_cascade(label="Automation", menu=macro_menu)

        # -------------------- CHARTS MENU --------------------
        chart_menu = tk.Menu(menu, tearoff=0)
        chart_menu.add_command(label="Insert Chart", command=self.insert_chart)
        chart_menu.add_command(label="Export Chart as PNG", command=self.export_chart_png)
        menu.add_cascade(label="Charts", menu=chart_menu)

        # -------------------- FUNCTIONS MENU --------------------
        func_menu = tk.Menu(menu, tearoff=0)
        func_menu.add_command(label="Add Custom Function", command=self.add_custom_function_dialog)
        func_menu.add_command(label="Show Functions", command=self.show_function_guide)
        func_menu.add_command(label="Ask AI", command=self.ask_ai)
        menu.add_cascade(label="Functions", menu=func_menu)

        # -------------------- SMART AI MENU --------------------
        ai_menu = tk.Menu(menu, tearoff=0)
        ai_menu.add_command(label="📊 Analyze Sheet", command=self.analyze_sheet)
        ai_menu.add_command(label="❓ Explain Formula", command=self.explain_formula)
        ai_menu.add_command(label="🧠 Generate Formula", command=self.generate_formula)
        ai_menu.add_command(label="🔒 Set API Key", command=self.set_api_key)
        menu.add_cascade(label="Smart AI", menu=ai_menu)

        # -------------------- HELP MENU --------------------
        help_menu = tk.Menu(menu, tearoff=0)
        help_menu.add_command(label="About", command=self.show_about)
        help_menu.add_command(label="Help", command=self.show_help)
        help_menu.add_command(label="Export Help as Text", command=self.export_help_text)
        menu.add_cascade(label="Help", menu=help_menu)

        # -------------------- QUICK ACTION BUTTONS --------------------
        ttk.Button(text="✨ Formula AI", command=self.ai_formula_builder).pack(side="left")
        ttk.Button(text="📈 Analyze", command=self.analyze_sheet_ai).pack(side="left")

    def setup_shortcuts(self):
        self.root.bind_all("<Control-n>", lambda e: self.add_new_sheet())
        self.root.bind_all("<Control-o>", lambda e: self.load_excel())
        self.root.bind_all("<Control-s>", lambda e: self.save_excel())
        self.root.bind_all("<Control-z>", lambda e: self.undo())
        self.root.bind_all("<Control-y>", lambda e: self.redo())

    def build_toolbar(self):
        toolbar = ttk.Frame(self.root, padding=5)
        toolbar.pack(side="top", fill="x")

        ttk.Button(toolbar, text="💾 Save", command=self.save_current_file).pack(side="left")
        ttk.Button(toolbar, text="↩ Undo", command=self.undo_action).pack(side="left")
        ttk.Button(toolbar, text="↪ Redo", command=self.redo_action).pack(side="left")
        ttk.Button(toolbar, text="📊 Chart", command=self.create_chart).pack(side="left")
        ttk.Button(toolbar, text="🧮 Calc", command=self.open_calculator).pack(side="left")
        ttk.Button(toolbar, text="🤖 Smart AI", command=self.smart_ai).pack(side="left")
        ttk.Button(toolbar, text="🌓 Theme", command=self.toggle_theme).pack(side="left")

        self.toolbar = toolbar

    def select_cell(self, row, col):
        if self.pending_bg_color:
            self.cells[row][col].config(bg=self.pending_bg_color)
            self.pending_bg_color = None  # reset after applying
        if self.pending_text_color:
            self.cells[row][col].config(fg=self.pending_text_color)
            self.pending_text_color = None  # reset after applying

    def show_function_guide(self):
        guide_text = (
            "Function Guide:\n"
            "You can use the following functions in your formulas:\n\n" +
            "\n".join(f"- {fn}" for fn in FUNCTION_LIST)
        )
        messagebox.showinfo("Function Guide", guide_text)

    def FUNC_FILTER(self, range_values, predicate_lambda_str):
        """
        Example usage in formula: =FILTER(A1:A10, 'lambda x: float(x)>10')
        predicate_lambda_str must be a valid lambda expression as a string.
        """
        try:
            # Ensure range_values is list-like
            flat = list(range_values) if isinstance(range_values, (list, tuple)) else [range_values]
            pred = eval(predicate_lambda_str)
            return [v for v in flat if pred(v)]
        except Exception:
            return []

    def choose_bg_color(self):
        import tkinter.colorchooser as colorchooser
        color = colorchooser.askcolor(title="Choose Background Color")[1]
        if color:
            self.pending_bg_color = color
            self.ask_cell_for_color("background")

    def choose_text_color(self):
        import tkinter.colorchooser as colorchooser
        color = colorchooser.askcolor(title="Choose Text Color")[1]
        if color:
            self.pending_text_color = color
            self.ask_cell_for_color("text")

    def ask_cell_for_color(self, mode):
        import tkinter.simpledialog as simpledialog
        cell = simpledialog.askstring("Cell Address", f"Enter the cell to apply {mode} color (e.g., A1, C5):")
        if cell:
            self.apply_color_to_cell(cell.upper(), mode)

    def apply_color_to_cell(self, cell_address, mode):
        try:
            col_letter = ''.join(filter(str.isalpha, cell_address))
            row_number = int(''.join(filter(str.isdigit, cell_address))) - 1
            col_number = ord(col_letter) - ord('A')

            if mode == "background" and self.pending_bg_color:
                self.cells[row_number][col_number].config(bg=self.pending_bg_color)
                self.pending_bg_color = None
            elif mode == "text" and self.pending_text_color:
                self.cells[row_number][col_number].config(fg=self.pending_text_color)
                self.pending_text_color = None
        except Exception as e:
            import tkinter.messagebox as messagebox
            messagebox.showerror("Error", f"Invalid cell address or selection: {cell_address}")

    def on_cell_click(self, event):
        widget = event.widget
        # Assuming each cell is a Label or Entry
        self.current_cell_row = widget.grid_info()['row']
        self.current_cell_col = widget.grid_info()['column']
        for r in range(self.rows):
            for c in range(self.cols):
                self.cells[r][c].bind("<Button-1>", self.on_cell_click)

    def FUNC_SORT(self, range_values, reverse=False):
        try:
            flat = list(range_values)
            return sorted(flat, reverse=bool(reverse))
        except Exception:
            return range_values

    def FUNC_UNIQUE(self, range_values):
        try:
            seen = set()
            out = []
            for v in range(range_values) if isinstance(range_values, (list, tuple)) else [range_values]:
                if v not in seen:
                    seen.add(v)
                    out.append(v)
            return out
        except Exception:
            return range_values

    # Register the above to user_functions if not already
    def register_array_functions(self):
        self.user_functions.update({
            "FILTER": lambda rng, pred: self.FUNC_FILTER(rng, pred),
            "SORT": lambda rng, rev=False: self.FUNC_SORT(rng, rev),
            "UNIQUE": lambda rng: self.FUNC_UNIQUE(rng),
        })

    # ----------- 2) Pivot table builder (simple) -----------
    def create_pivot_table(self):
        """
        Opens a dialog to create a simple pivot table from the active sheet.
        Group by one column and aggregate another using sum/mean/count.
        """
        sheet = self.get_active_sheet()
        if not sheet:
            messagebox.showwarning("Pivot", "No active sheet.")
            return
        data = sheet.get_sheet_data()
        if not data:
            messagebox.showwarning("Pivot", "Sheet empty.")
            return

        # Convert to DataFrame (assume first row is header if non-empty strings present)
        df = pd.DataFrame(data)
        # Ask user for column indexes (1-based for ease)
        try:
            col_group = simpledialog.askinteger("Pivot - Group Column", "Group by column index (1..):", minvalue=1)
            col_agg = simpledialog.askinteger("Pivot - Aggregate Column", "Aggregate column index (1..):", minvalue=1)
            agg_func = simpledialog.askstring("Pivot - Function", "Aggregation function (sum|mean|count):",
                                              initialvalue="sum")
            if not col_group or not col_agg:
                return
            group_idx = col_group - 1
            agg_idx = col_agg - 1
            df_group = df[[group_idx, agg_idx]].copy()
            df_group.columns = ["group", "value"]
            # Try numeric conversion
            df_group["value"] = pd.to_numeric(df_group["value"], errors="coerce")
            if agg_func.lower() == "sum":
                res = df_group.groupby("group", dropna=False).sum().reset_index()
            elif agg_func.lower() == "mean":
                res = df_group.groupby("group", dropna=False).mean().reset_index()
            else:
                res = df_group.groupby("group", dropna=False).count().reset_index()
            # Open result in new sheet
            new_sheet = self.add_new_sheet_tab(name="Pivot")
            # Convert to list of lists and populate
            rows = [res.columns.tolist()] + res.values.tolist()
            # Ensure strings
            rows = [[str(cell) for cell in row] for row in rows]
            if hasattr(new_sheet, "set_sheet_data"):
                new_sheet.set_sheet_data(rows)
            messagebox.showinfo("Pivot", "Pivot table created in new sheet 'Pivot'.")
        except Exception as e:
            messagebox.showerror("Pivot Error", str(e))

    # ----------- 3) Data validation (dropdown) -----------
    def add_data_validation(self):
        """
        Simple data validation: make selected column a dropdown with given choices.
        Store validations in-memory (self.data_validations).
        """
        sheet = self.get_active_sheet()
        if not sheet:
            messagebox.showwarning("Validation", "No active sheet.")
            return
        choices_str = simpledialog.askstring("Validation", "Enter comma-separated choices for dropdown:")
        if not choices_str:
            return
        choices = [c.strip() for c in choices_str.split(",") if c.strip()]
        col_idx = simpledialog.askinteger("Validation", "Apply to column index (1..):", minvalue=1)
        if not col_idx:
            return
        col = col_idx - 1
        # store validations in a dict: {(sheet_frame, col): choices}
        if not hasattr(self, "data_validations"):
            self.data_validations = {}
        self.data_validations[(self.notebook.select(), col)] = choices
        messagebox.showinfo("Validation", f"Dropdown validation applied to column {col_idx}.")

    def enforce_data_validation_on_edit(self, sheet, r, c, value):
        """
        Hook this into the cell edit event: when a cell is edited, check validations and
        if invalid, warn and revert.
        """
        key = (self.notebook.select(), c)
        if hasattr(self, "data_validations") and key in self.data_validations:
            allowed = self.data_validations[key]
            if value not in allowed:
                messagebox.showwarning("Validation",
                                       f"Value '{value}' not allowed for this column.\nAllowed: {allowed}")
                # revert: attempt to reset previous value (best-effort)
                sheet.set_cell_data(r, c, "")

    # ----------- 4) Conditional formatting (basic rules) -----------
    def add_conditional_format_rule(self):
        """
        Adds a simple conditional formatting rule for a column:
        e.g., column 2, '>' , 100, color '#ffcccc'
        Rules stored in self.cond_formats as list of dicts.
        """
        sheet = self.get_active_sheet()
        if not sheet:
            return
        try:
            col_idx = simpledialog.askinteger("Conditional Format", "Column index (1..):", minvalue=1)
            op = simpledialog.askstring("Conditional Format", "Operator (>, <, ==, >=, <=):", initialvalue=">")
            threshold = simpledialog.askstring("Conditional Format", "Threshold value (number):")
            color = colorchooser.askcolor(title="Choose highlight color")[1]
            if not (col_idx and op and threshold and color):
                return
            rule = {"sheet_id": self.notebook.select(), "col": col_idx - 1, "op": op, "threshold": float(threshold),
                    "color": color}
            if not hasattr(self, "cond_formats"):
                self.cond_formats = []
            self.cond_formats.append(rule)
            self.apply_conditional_formats_to_sheet(sheet)
            messagebox.showinfo("Conditional Format", "Rule added and applied.")
        except Exception as e:
            messagebox.showerror("Cond Format Error", str(e))

    def apply_conditional_formats_to_sheet(self, sheet):
        """
        Iterate rules and apply highlights. Requires tksheet highlight API.
        """
        if not hasattr(self, "cond_formats"):
            return
        sheet_id = self.notebook.select()
        data = sheet.get_sheet_data()
        for rule in self.cond_formats:
            if rule.get("sheet_id") != sheet_id:
                continue
            col = rule["col"]
            op = rule["op"]
            thr = rule["threshold"]
            color = rule["color"]
            # Iterate rows and apply highlight where condition true
            for r, row in enumerate(data):
                try:
                    val = row[col]
                    val_num = float(val) if str(val).replace('.', '', 1).lstrip('+-').isdigit() else None
                    cond = False
                    if val_num is not None:
                        if op == ">":
                            cond = val_num > thr
                        elif op == "<":
                            cond = val_num < thr
                        elif op == ">=":
                            cond = val_num >= thr
                        elif op == "<=":
                            cond = val_num <= thr
                        elif op == "==":
                            cond = val_num == thr
                    if cond:
                        try:
                            sheet.highlight_cells(row=r, column=col, bg=color)
                        except Exception:
                            # fallback: try setting cell tag or skip
                            pass
                except Exception:
                    continue

    # ----------- 5) Macro recorder (very simple) -----------
    def start_macro_recording(self):
        self.macro_recording = True
        self.macro_actions = []
        self.status_var.set("Macro recording ON")

    def stop_macro_recording(self):
        self.macro_recording = False
        if not hasattr(self, "macros"):
            self.macros = []
        name = simpledialog.askstring("Macro", "Save macro as name:")
        if not name:
            name = f"macro_{len(self.macros) + 1}"
        self.macros.append({"name": name, "actions": getattr(self, "macro_actions", [])})
        self.status_var.set(f"Macro '{name}' saved")

    def record_macro_action(self, action_name, **kwargs):
        """
        Call this helper at significant user actions (add_row, add_column, set_cell_data, etc.)
        Example action: ("set_cell", row=1, col=1, value="Hello")
        """
        if getattr(self, "macro_recording", False):
            self.macro_actions.append({"action": action_name, "params": kwargs})

    def run_macro(self):
        if not hasattr(self, "macros") or not self.macros:
            messagebox.showinfo("Macro", "No macros recorded.")
            return
        names = [m["name"] for m in self.macros]
        idx = simpledialog.askinteger("Run Macro", f"Choose macro index (1..{len(names)}):\n" + "\n".join(
            f"{i + 1}. {n}" for i, n in enumerate(names)), minvalue=1, maxvalue=len(names))
        if not idx:
            return
        macro = self.macros[idx - 1]
        for act in macro["actions"]:
            a = act["action"];
            p = act["params"]
            try:
                if a == "set_cell":
                    sheet = self.get_active_sheet()
                    sheet.set_cell_data(p["row"], p["col"], p["value"])
                elif a == "add_row":
                    self.add_row()
                elif a == "add_column":
                    self.add_column()
                # add more action types as needed
            except Exception:
                continue
        messagebox.showinfo("Macro", f"Macro '{macro['name']}' executed.")

    # ----------- 6) Task scheduler (simple) -----------
    def schedule_task(self):
        """
        Schedule a simple task: call a function every N seconds.
        This stores tasks in self.scheduled_tasks.
        """
        try:
            name = simpledialog.askstring("Schedule Task", "Task name:")
            interval = simpledialog.askinteger("Schedule Task", "Interval in seconds:", minvalue=1)
            if not name or not interval:
                return
            if not hasattr(self, "scheduled_tasks"):
                self.scheduled_tasks = {}

            def task_runner():
                # Example: auto-recalculate formulas
                try:
                    for frame, sheet in self.sheets.items():
                        try:
                            sheet_data = sheet.get_sheet_data()
                            # optional: call your evaluate_formulas on each sheet
                            self.evaluate_formulas()
                        except Exception:
                            continue
                finally:
                    # reschedule
                    self.root.after(interval * 1000, task_runner)

            # start the scheduled task
            self.scheduled_tasks[name] = {"interval": interval}
            self.root.after(interval * 1000, task_runner)
            messagebox.showinfo("Scheduled", f"Task '{name}' scheduled every {interval}s.")
        except Exception as e:
            messagebox.showerror("Schedule Error", str(e))

    # ----------- 7) Chart export (PNG) -----------
    def export_chart_png(self):
        """
        Export the last displayed chart (matplotlib) or create one from selected columns.
        """
        try:
            sheet = self.get_active_sheet()
            data = sheet.get_sheet_data()
            x = []
            y = []
            for row in data:
                if len(row) >= 2:
                    try:
                        x.append(float(row[0]));
                        y.append(float(row[1]))
                    except:
                        continue
            if not x or not y:
                messagebox.showwarning("Export Chart", "Not enough numeric data in first two columns.")
                return
            plt.figure()
            plt.plot(x, y)
            plt.title("Exported Chart")
            # Ask save location
            path = filedialog.asksaveasfilename(defaultextension=".png", filetypes=[("PNG Image", "*.png")])
            if not path:
                return
            plt.savefig(path, bbox_inches="tight")
            plt.close()
            messagebox.showinfo("Chart Exported", f"Chart saved to {path}")
        except Exception as e:
            messagebox.showerror("Chart Export Error", str(e))

    def ai_formula_builder(self):
        api_key = get_api_key()
        if not api_key:
            return

        prompt = simpledialog.askstring(
            "AI Formula Builder",
            "Describe what you want to calculate (e.g., 'total sales in column B'):"
        )
        if not prompt:
            return

        try:
            openai.api_key = api_key
            response = openai.ChatCompletion.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "Convert natural language to spreadsheet formula syntax (A1 style)."},
                    {"role": "user", "content": prompt}
                ]
            )
            formula = response.choices[0].message.content.strip()
            self.formula_var.set("=" + formula)
            self.status_var.set("AI Formula Suggestion Applied")
        except Exception as e:
            messagebox.showerror("AI Error", str(e))

    def show_formula_suggestions(self, event):
        FORMULAS = [
            "SUM()", "AVERAGE()", "MIN()", "MAX()", "IF()", "COUNT()",
            "VLOOKUP()", "HLOOKUP()", "LEN()", "ROUND()", "ABS()",
            "DATE()", "TIME()", "NOW()", "AND()", "OR()", "NOT()"
        ]
        text = self.formula_var.get().upper()
        if text.startswith("="):
            query = text[1:]
            matches = [f for f in FORMULAS if query in f]
            if matches:
                self.suggestion_box.delete(0, tk.END)
                for f in matches:
                    self.suggestion_box.insert(tk.END, f)
                self.suggestion_box.place(x=40, y=25, width=200)
            else:
                self.suggestion_box.pack_forget()
        else:
            self.suggestion_box.pack_forget()

    def select_suggestion(self, event):
        value = self.suggestion_box.get(tk.ACTIVE)
        self.formula_var.set("=" + value)
        self.suggestion_box.pack_forget()

    def show_help(self):
        import tkinter as tk

        # Create simple new window
        help_window = tk.Toplevel(self.root)
        help_window.title("Alaada Help")
        help_window.geometry("800x600")

        # Scrollbar + Text
        scrollbar = tk.Scrollbar(help_window)
        scrollbar.pack(side="right", fill="y")

        text_area = tk.Text(help_window, wrap="word", yscrollcommand=scrollbar.set)
        text_area.pack(side="left", fill="both", expand=True)
        scrollbar.config(command=text_area.yview)

        # Insert help content
        help_text = """
        ====================================================
                            ALAADA HELP
        ====================================================

        Welcome to Alaada Spreadsheets — the intelligent, next-generation spreadsheet system built for speed, power, and innovation.

        ──────────────────────────
        📁 FILE MENU
        ──────────────────────────
        • New Sheet — Create a new blank sheet  (Ctrl+N)
        • Open Excel — Load .xlsx files directly  (Ctrl+O)
        • Save Excel — Save current sheet to Excel  (Ctrl+S)
        • Recent Files — Quickly reopen recent workbooks
        • Exit — Close the application

        ──────────────────────────
        ✏️ EDIT MENU
        ──────────────────────────
        • Undo / Redo — Step backward or forward in history
        • Add / Delete Row or Column
        • Add 1000 Rows / Columns — Quickly expand your sheet
        • Add Rows... / Columns... — Add any number interactively

        ──────────────────────────
        🎨 FORMAT MENU
        ──────────────────────────
        • Set Background Color — Change selected cells’ fill color
        • Set Text Color — Change selected cells’ font color

        ──────────────────────────
        🧮 TOOLS MENU
        ──────────────────────────
        • Calculator — Open Alaada’s built-in calculator tool

        ──────────────────────────
        📊 CHARTS MENU
        ──────────────────────────
        • Insert Chart — Create bar, line, or pie charts instantly

        ──────────────────────────
        🧠 FUNCTIONS MENU
        ──────────────────────────
        • Add Custom Function — Add your own reusable formulas
        • Show Functions — View supported formulas and syntax
        • Ask AI — Let AI explain or suggest formulas for you

        ──────────────────────────
        🤖 SMART AI MENU (Tier 4)
        ──────────────────────────
        • 📊 Analyze Sheet — Summarize & find insights
        • ❓ Explain Formula — AI explanation of formulas
        • 🧮 Generate Formula — Auto-create formulas from natural text
        • 🔒 Set API Key — Configure AI access securely

        ──────────────────────────
        ✨ QUICK ACTION BUTTONS
        ──────────────────────────
        • ✨ Formula AI — Suggest or build formulas automatically
        • 📈 Analyze — AI-powered sheet analysis

        ──────────────────────────
        🚀 TIER FEATURES SUMMARY
        ──────────────────────────
        Tier 1 — Core Spreadsheet Engine  
            • Grid editing, formulas, saving/loading, multi-sheet support  

        Tier 2 — Visuals & Usability  
            • Charts, formatting, color themes, auto cell updates  

        Tier 3 — Power Tools  
            • History system, custom functions, analysis tools, and extended editing  

        Tier 4 — Intelligent Automation  
            • AI assistant, pivot-style analytics, scripting groundwork, 
              advanced charting & smart UX  

        ──────────────────────────
        💡 TIP
        ──────────────────────────
        You can export this help text via:  
        Help → Export Help as Text

        ──────────────────────────
        ALAADA — Where Precision Meets Possibility
        Developed by Arzo Das
        ──────────────────────────
    """
        text_area.insert("1.0", help_text)
        text_area.config(state="disabled")  # make text read-only

    def export_help_text(self):
        help_text = (
"""====================================================
                            ALAADA HELP
        ====================================================

        Welcome to Alaada Spreadsheets — the intelligent, next-generation spreadsheet system built for speed, power, and innovation.

        ──────────────────────────
        📁 FILE MENU
        ──────────────────────────
        • New Sheet — Create a new blank sheet  (Ctrl+N)
        • Open Excel — Load .xlsx files directly  (Ctrl+O)
        • Save Excel — Save current sheet to Excel  (Ctrl+S)
        • Recent Files — Quickly reopen recent workbooks
        • Exit — Close the application

        ──────────────────────────
        ✏️ EDIT MENU
        ──────────────────────────
        • Undo / Redo — Step backward or forward in history
        • Add / Delete Row or Column
        • Add 1000 Rows / Columns — Quickly expand your sheet
        • Add Rows... / Columns... — Add any number interactively

        ──────────────────────────
        🎨 FORMAT MENU
        ──────────────────────────
        • Set Background Color — Change selected cells’ fill color
        • Set Text Color — Change selected cells’ font color

        ──────────────────────────
        🧮 TOOLS MENU
        ──────────────────────────
        • Calculator — Open Alaada’s built-in calculator tool

        ──────────────────────────
        📊 CHARTS MENU
        ──────────────────────────
        • Insert Chart — Create bar, line, or pie charts instantly

        ──────────────────────────
        🧠 FUNCTIONS MENU
        ──────────────────────────
        • Add Custom Function — Add your own reusable formulas
        • Show Functions — View supported formulas and syntax
        • Ask AI — Let AI explain or suggest formulas for you

        ──────────────────────────
        🤖 SMART AI MENU (Tier 4)
        ──────────────────────────
        • 📊 Analyze Sheet — Summarize & find insights
        • ❓ Explain Formula — AI explanation of formulas
        • 🧮 Generate Formula — Auto-create formulas from natural text
        • 🔒 Set API Key — Configure AI access securely

        ──────────────────────────
        ✨ QUICK ACTION BUTTONS
        ──────────────────────────
        • ✨ Formula AI — Suggest or build formulas automatically
        • 📈 Analyze — AI-powered sheet analysis

        ──────────────────────────
        🚀 TIER FEATURES SUMMARY
        ──────────────────────────
        Tier 1 — Core Spreadsheet Engine  
            • Grid editing, formulas, saving/loading, multi-sheet support  

        Tier 2 — Visuals & Usability  
            • Charts, formatting, color themes, auto cell updates  

        Tier 3 — Power Tools  
            • History system, custom functions, analysis tools, and extended editing  

        Tier 4 — Intelligent Automation  
            • AI assistant, pivot-style analytics, scripting groundwork, 
              advanced charting & smart UX  

        ──────────────────────────
        💡 TIP
        ──────────────────────────
        You can export this help text via:  
        Help → Export Help as Text

        ──────────────────────────
        ALAADA — Where Precision Meets Possibility
        Developed by Arzo Das
        ──────────────────────────"""
        )
        file_path = filedialog.asksaveasfilename(defaultextension=".txt", filetypes=[("Text files", "*.txt")])
        if file_path:
            with open(file_path, "w") as f:
                f.write(help_text)
            messagebox.showinfo("Exported", f"Help exported to {file_path}")

    def show_about(self):
        about_text = """
Alaada – Where Precision Meets Possibility

Alaada is a cutting-edge software suite developed by Arzo Das, a passionate 14-year-old innovator dedicated to building intelligent and user-friendly digital solutions. 

Vision:
- To empower users with tools that combine simplicity, accuracy, and powerful functionality.
- To provide a seamless spreadsheet experience that goes beyond conventional software.

Key Features:
- Interactive and dynamic spreadsheets
- Advanced formula management with AI support
- Charts, analytics, and smart automation
- Fully customizable and extensible

Mission:
Alaada aims to redefine how users interact with digital tools, making productivity faster, smarter, and more enjoyable.

© 2025 Alaada – All rights reserved.
"""
        messagebox.showinfo("About ALAADA", about_text)

    def add_new_sheet(self):
        frame = tk.Frame(self.notebook)
        self.notebook.add(frame, text=f"Sheet {len(self.sheets) + 1}")
        sheet = Sheet(frame, width=1000, height=600, total_rows=1000, total_columns=1000)
        sheet.pack(expand=1, fill="both")
        sheet.enable_bindings("all")
        self.sheets[frame] = sheet
        self.undo_stacks[sheet] = []
        self.redo_stacks[sheet] = []
        sheet.bind("end_edit_cell", self.evaluate_formulas)

    def add_new_sheet_tab(self, name="New Sheet"):
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text=name)
        sheet = Sheet(frame, width=1000, height=600, total_rows=1000, total_columns=1000)
        sheet.pack(expand=1, fill="both")
        sheet.enable_bindings("all")
        self.sheets[frame] = sheet
        self.notebook.select(frame)
        return sheet  # <-- must return the Sheet

    def evaluate_formulas(self, event=None):
        sheet = self.get_active_sheet()
        data = sheet.get_sheet_data()
        for r, row in enumerate(data):
            for c, cell in enumerate(row):
                if isinstance(cell, str) and cell.startswith("="):
                    try:
                        expr = self.parse_formula(cell[1:], data)
                        value = eval(expr, {**self.user_functions, "math": math, "np": np})
                        sheet.set_cell_data(r, c, value)
                    except Exception:
                        pass

    def get_active_sheet(self):
        current_tab = self.notebook.select()
        return self.sheets[self.root.nametowidget(current_tab)]

    def get_cell_value(self, row, col):
        """Return the value of a cell at (row, col) as float if possible, else 0"""
        try:
            val = self.sheet_data[row][col]
            if val == "" or val is None:
                return 0
            return float(val)
        except:
            return 0

    import re

    def parse_formula(self, formula):
        """
        Converts cell references and ranges to Python-evaluable lists.
        """

        def cell_to_val(match):
            col = ord(match.group(1).upper()) - 65
            row = int(match.group(2)) - 1
            return str(self.get_cell_value(row, col))

        # Replace single cell references
        formula = re.sub(r'([A-Za-z])(\d+)', cell_to_val, formula)

        # Replace ranges like A1:A10 with list of values
        def range_to_list(match):
            start_col = ord(match.group(1).upper()) - 65
            start_row = int(match.group(2)) - 1
            end_col = ord(match.group(3).upper()) - 65
            end_row = int(match.group(4)) - 1
            values = [self.get_cell_value(r, c) for r in range(start_row, end_row + 1) for c in
                      range(start_col, end_col + 1)]
            return str(values)

        formula = re.sub(r'([A-Za-z])(\d+):([A-Za-z])(\d+)', range_to_list, formula)
        return formula

    def analyze_sheet_ai(self):
        api_key = get_api_key()
        if not api_key:
            return

        sheet = self.get_active_sheet()
        if not sheet:
            messagebox.showwarning("No Sheet", "No active sheet to analyze.")
            return

        data = sheet.get_sheet_data()
        flat_data = "\n".join(str(row) for row in data)

        try:
            openai.api_key = api_key
            response = openai.ChatCompletion.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a data analyst. Summarize spreadsheet data insightfully."},
                    {"role": "user", "content": f"Analyze this spreadsheet:\n{flat_data}"}
                ]
            )
            result = response.choices[0].message.content.strip()
            self.show_ai_result(result)
        except Exception as e:
            messagebox.showerror("AI Error", str(e))

    def show_ai_result(self, text):
        top = tk.Toplevel(self.root)
        top.title("Alaada AI Data Analysis")
        text_box = tk.Text(top, wrap="word", height=20, width=80)
        text_box.insert("1.0", text)
        text_box.config(state="disabled")
        text_box.pack(padx=10, pady=10)

    def load_excel(self):
        file_path = filedialog.askopenfilename(filetypes=[("Excel Files", "*.xlsx")])
        if not file_path:
            return

        try:
            pd.set_option('future.no_silent_downcasting', True)
            df = pd.read_excel(file_path, header=None, dtype=str)  # read everything as text
            df = df.replace("nan", "", regex=True).replace(np.nan, "", regex=True)  # remove NaN values

            self.add_new_sheet()
            sheet = self.get_active_sheet()

            for r in range(df.shape[0]):
                for c in range(df.shape[1]):
                    val = df.iat[r, c]
                    if pd.isna(val) or val == "nan":
                        val = ""  # make sure empty cell stays empty
                    sheet.set_cell_data(r, c, str(val))

            self.add_to_recent(file_path)
            messagebox.showinfo("File Loaded", f"Opened '{os.path.basename(file_path)}' successfully without NaN.")
            logging.info(f"Opened {file_path} (NaN removed).")

        except Exception as e:
            messagebox.showerror("Error", f"Failed to open Excel file:\n{e}")
            logging.exception(f"Error loading Excel file: {e}")

    def save_sheet(self, filepath):
        """Save the active sheet safely using UTF-8 encoding."""
        try:
            sheet = self.get_active_sheet()
            data = sheet.get_sheet_data()  # Returns list of lists
            content = "\n".join([",".join(map(str, row)) for row in data])

            with open(filepath, "w", encoding="utf-8", errors="replace") as f:
                f.write(content)

            self.add_to_recent(filepath)
            messagebox.showinfo("Saved", f"Sheet saved successfully as {os.path.basename(filepath)}.")
            logging.info(f"Sheet saved: {filepath}")
        except Exception as e:
            messagebox.showerror("Save Error", f"Could not save file:\n{e}")
            logging.exception(f"Error saving sheet: {e}")

    def save_excel(self):
        file_path = filedialog.asksaveasfilename(defaultextension=".xlsx", filetypes=[("Excel Files", "*.xlsx")])
        if file_path:
            sheet = self.get_active_sheet()
            data = sheet.get_sheet_data()
            df = pd.DataFrame(data)
            df.to_excel(file_path, index=False, header=False)
        self.add_to_recent(file_path)

    def SUM(*args):
        total = 0
        for arg in args:
            if isinstance(arg, list):
                total += sum(arg)
            else:
                total += float(arg)
        return total

    def AVG(*args):
        flat = []
        for arg in args:
            if isinstance(arg, list):
                flat.extend(arg)
            else:
                flat.append(float(arg))
        return sum(flat) / len(flat) if flat else 0

    def MAX(*args):
        flat = []
        for arg in args:
            if isinstance(arg, list):
                flat.extend(arg)
            else:
                flat.append(float(arg))
        return max(flat) if flat else 0

    def MIN(*args):
        flat = []
        for arg in args:
            if isinstance(arg, list):
                flat.extend(arg)
            else:
                flat.append(float(arg))
        return min(flat) if flat else 0

    def COUNT(*args):
        flat = []
        for arg in args:
            if isinstance(arg, list):
                flat.extend(arg)
            else:
                flat.append(arg)
        return len([x for x in flat if x != "" and x is not None])

    def evaluate_formula(self, formula):
        """
        Evaluate the formula string safely using built-in functions like SUM, AVG, etc.
        """
        formula = self.parse_formula(formula)
        try:
            result = eval(formula, {"SUM": self.SUM, "AVG": self.AVG, "MAX": self.MAX, "MIN": self.MIN, "COUNT": self.COUNT})
        except:
            result = "#ERROR"
        return result

    def insert_chart(self):
        sheet = self.get_active_sheet()
        data = sheet.get_sheet_data()
        x = []
        y = []
        for row in data:
            if len(row) >= 2:
                try:
                    x_val = float(row[0])
                    y_val = float(row[1])
                    x.append(x_val)
                    y.append(y_val)
                except:
                    continue
        if x and y:
            plt.plot(x, y)
            plt.title("Chart")
            plt.xlabel("X")
            plt.ylabel("Y")
            plt.show()

    def set_bg_color(self):
        color = colorchooser.askcolor()[1]
        if color:
            sheet = self.get_active_sheet()
            sheet.highlight_cells(bg=color)

    def set_text_color(self):
        color = colorchooser.askcolor()[1]
        if color:
            sheet = self.get_active_sheet()
            sheet.highlight_cells(fg=color)

    def undo(self):
        sheet = self.get_active_sheet()
        if self.undo_stacks[sheet]:
            last_state = self.undo_stacks[sheet].pop()
            self.redo_stacks[sheet].append(sheet.get_sheet_data())
            sheet.set_sheet_data(last_state)

    def redo(self):
        sheet = self.get_active_sheet()
        if self.redo_stacks[sheet]:
            next_state = self.redo_stacks[sheet].pop()
            self.undo_stacks[sheet].append(sheet.get_sheet_data())
            sheet.set_sheet_data(next_state)

    def add_row(self):
        sheet = self.get_active_sheet()
        sheet.insert_row("end")

    def add_column(self):
        sheet = self.get_active_sheet()
        sheet.insert_column("end")

    def delete_row(self):
        sheet = self.get_active_sheet()
        sheet.delete_row(sheet.get_currently_selected()[0])

    def delete_column(self):
        sheet = self.get_active_sheet()
        sheet.delete_column(sheet.get_currently_selected()[1])

    def add_custom_function_dialog(self):
        name = simpledialog.askstring("Function Name", "Enter function name:")
        expression = simpledialog.askstring("Function Body", "Enter lambda expression (use args):")
        if name and expression:
            try:
                self.user_functions[name.upper()] = eval(f"lambda *args: {expression}")
                messagebox.showinfo("Success", f"Function '{name}' added!")
            except:
                messagebox.showerror("Error", "Invalid function definition.")

    def ask_ai(self):
        prompt = simpledialog.askstring("Ask AI", "What would you like to ask?")
        if prompt:
            try:
                response = openai.ChatCompletion.create(
                    model="gpt-3.5-turbo",
                    messages=[{"role": "user", "content": prompt}]
                )
                answer = response["choices"][0]["message"]["content"]
                messagebox.showinfo("AI Response", answer)
            except Exception as e:
                messagebox.showerror("AI Error", str(e))

    def analyze_sheet(self):
        sheet = self.get_active_sheet()
        data = sheet.get_sheet_data()
        flat_data = [float(cell) for row in data for cell in row if isinstance(cell, (int, float, str)) and str(cell).replace('.', '', 1).isdigit()]
        if flat_data:
            analysis = f"Mean: {np.mean(flat_data):.2f}\nMedian: {np.median(flat_data):.2f}\nStd Dev: {np.std(flat_data):.2f}"
            messagebox.showinfo("Analysis", analysis)

    def explain_formula(self):
        formula = simpledialog.askstring("Formula", "Enter a formula to explain:")
        if formula:
            explanation = f"This formula computes: {formula}. Values are dynamically substituted from sheet cells."
            messagebox.showinfo("Explanation", explanation)

    def generate_formula(self):
        instruction = simpledialog.askstring("Formula Generator", "Describe what you want to calculate:")
        if instruction:
            try:
                response = openai.ChatCompletion.create(
                    model="gpt-3.5-turbo",
                    messages=[{"role": "user", "content": f"Write an Excel-like formula to: {instruction}"}]
                )
                messagebox.showinfo("Generated Formula", response.choices[0].message.content.strip())
            except Exception as e:
                messagebox.showerror("AI Error", str(e))

    def set_api_key(self):
        key = simpledialog.askstring("API Key", "Enter your OpenAI API Key:", show='*')
        if key:
            openai.api_key = key
            messagebox.showinfo("API Key Set", "OpenAI API key has been updated successfully.")

    def show_about(self):
        import tkinter as tk

        about_window = tk.Toplevel(self.root)
        about_window.title("About Alaada")
        about_window.geometry("600x400")

        text_area = tk.Text(about_window, wrap="word")
        text_area.pack(fill="both", expand=True, padx=10, pady=10)

        about_text = """
    Alaada – Where Precision Meets Possibility

    Alaada is a cutting-edge software suite developed by Arzo Das, a passionate 14-year-old innovator dedicated to building intelligent and user-friendly digital solutions. 

    Vision:
    - To empower users with tools that combine simplicity, accuracy, and powerful functionality.
    - To provide a seamless spreadsheet experience that goes beyond conventional software.

    Key Features:
    - Interactive and dynamic spreadsheets
    - Advanced formula management with AI support
    - Charts, analytics, and smart automation
    - Fully customizable and extensible

    Mission:
    Alaada aims to redefine how users interact with digital tools, making productivity faster, smarter, and more enjoyable.

    © 2025 Alaada – All rights reserved.
    """
        text_area.insert("1.0", about_text)
        text_area.config(state="disabled")  # read-only

        # Optional: Scrollbar if content is long
        scrollbar = tk.Scrollbar(about_window, command=text_area.yview)
        scrollbar.pack(side="right", fill="y")
        text_area.config(yscrollcommand=scrollbar.set)


if __name__ == "__main__":
    root = tk.Tk()
    app = SpreadsheetApp(root)
    root.mainloop()
