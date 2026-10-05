use super::*;

#[test]
fn a_record_keeps_javascripts_order_of_keys() {
    let vectors: Vec<(String, Vec<String>)> =
        serde_json::from_str(include_str!("../../tests/vectors/keys.json")).expect("key vectors");
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
