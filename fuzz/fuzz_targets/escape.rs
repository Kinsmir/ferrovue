#![no_main]

use ferrovue_fuzz::{reference_escape, unescape};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let s = String::from_utf8_lossy(data);
    let mut out = String::from("<p>");
    ferrovue_core::escape_into(&mut out, &s);
    let escaped = out
        .strip_prefix("<p>")
        .expect("escape_into kept what out held");
    assert_eq!(escaped, reference_escape(&s));
    assert_eq!(unescape(escaped).as_deref(), Ok(&*s));
    let mut again = String::new();
    ferrovue::escape_into(&mut again, &s);
    assert_eq!(again, escaped);
});
