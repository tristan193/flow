"""Deal email format repertoire (catalog + learn CLI)."""
from .catalog import (
    FormatCatalog,
    FormatMatch,
    ProviderSubcategory,
    get_catalog,
    load_catalog,
    reload_catalog,
)

__all__ = [
    "FormatCatalog",
    "FormatMatch",
    "ProviderSubcategory",
    "get_catalog",
    "load_catalog",
    "reload_catalog",
]
