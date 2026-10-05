use super::*;

#[test]
fn a_record_keeps_javascripts_order_of_keys() {
    let vectors: Vec<(String, Vec<String>)> =
        serde_json::from_str(include_str!("../../tests/vectors/keys.json")).expect("key vectors");
    assert!(vectors.len() >= 8, "the vectors were not all read");
    for (json, want) in &vectors {
        let record: Record<'_, i64> = serde_json::from_str(json).expect("a record");
        assert_eq!(record.keys().collect::<Vec<_>>(), *want, "{json}");
        let again: Record<'_, i64> =
            serde_json::from_str(&serde_json::to_string(&record).unwrap()).unwrap();
        assert_eq!(again, record);
    }
}

#[test]
fn a_record_takes_the_last_value_of_a_repeated_key_in_its_first_place() {
    let record: Record<'_, &str> = [("a", "1"), ("b", "2"), ("a", "3")].into_iter().collect();
    assert_eq!(
        record.iter().collect::<Vec<_>>(),
        [("a", &"3"), ("b", &"2")]
    );
    assert_eq!(record.len(), 2);
    assert!(Record::<'_, i64>::new().is_empty());
}

#[test]
fn a_record_with_an_entry_is_not_empty() {
    let record: Record<'_, i64> = [("a", 1)].into_iter().collect();
    assert!(!record.is_empty());
}

#[test]
fn a_record_read_from_anything_but_an_object_is_an_error_expecting_an_object() {
    let error = serde_json::from_str::<Record<'_, i64>>("[1]").unwrap_err();
    assert_eq!(
        error.to_string(),
        "invalid type: sequence, expected an object at line 1 column 0"
    );
}
