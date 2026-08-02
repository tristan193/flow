"""Deal email format repertoire (catalog + learn CLI)."""
from .catalog import FormatCatalog, FormatMatch, get_catalog, load_catalog, reload_catalog

__all__ = [
    "FormatCatalog",
    "FormatMatch",
    "get_catalog",
    "load_catalog",
    "reload_catalog",
]
