import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';

const TradeDetailScreen = ({ route }: any) => {
  const { trade } = route.params;
  const [notes, setNotes] = useState(trade?.notes || '');
  const [editing, setEditing] = useState(false);

  const pnlColor = trade?.pnl >= 0 ? '#22c55e' : '#ef4444';

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.symbol}>{trade?.symbol}</Text>
          <Text style={styles.time}>
            {trade?.entry_time && new Date(trade.entry_time).toLocaleString()}
          </Text>
        </View>
        <Text style={[styles.pnl, { color: pnlColor }]}>₹{trade?.pnl?.toFixed(2)}</Text>
      </View>

      <View style={styles.detailsCard}>
        <Text style={styles.cardTitle}>Trade Details</Text>

        <DetailRow label="Entry Price" value={`₹${trade?.entry_price?.toFixed(2)}`} />
        <DetailRow label="Exit Price" value={`₹${trade?.exit_price?.toFixed(2)}`} />
        <DetailRow label="Quantity" value={trade?.quantity} />
        <DetailRow label="Setup" value={trade?.setup_tag || 'N/A'} />

        <DetailRow
          label="Result"
          value={trade?.pnl > 0 ? '✓ Win' : '✗ Loss'}
          color={pnlColor}
        />
      </View>

      <View style={styles.detailsCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Notes</Text>
          <TouchableOpacity onPress={() => setEditing(!editing)}>
            <Text style={styles.editButton}>{editing ? 'Done' : 'Edit'}</Text>
          </TouchableOpacity>
        </View>

        {editing ? (
          <TextInput
            style={styles.notesInput}
            multiline
            value={notes}
            onChangeText={setNotes}
            placeholder="Add notes about this trade..."
          />
        ) : (
          <Text style={styles.notesText}>{notes || 'No notes added'}</Text>
        )}
      </View>

      <View style={styles.detailsCard}>
        <Text style={styles.cardTitle}>Statistics</Text>

        <DetailRow
          label="Risk/Reward"
          value={`1:${(trade?.pnl / Math.abs(trade?.pnl - 0) || 0).toFixed(2)}`}
        />
        <DetailRow
          label="Win/Loss %"
          value={trade?.pnl > 0 ? '+' + ((trade.pnl / trade.entry_price) * 100).toFixed(2) + '%' : ((trade.pnl / trade.entry_price) * 100).toFixed(2) + '%'}
          color={pnlColor}
        />
      </View>
    </ScrollView>
  );
};

const DetailRow = ({ label, value, color }: any) => (
  <View style={styles.detailRow}>
    <Text style={styles.label}>{label}</Text>
    <Text style={[styles.value, color && { color }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#667eea',
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  symbol: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  time: {
    color: '#ddd',
    fontSize: 12,
    marginTop: 5,
  },
  pnl: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  detailsCard: {
    backgroundColor: 'white',
    margin: 10,
    borderRadius: 8,
    padding: 15,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  editButton: {
    color: '#5a67d8',
    fontWeight: 'bold',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  label: {
    color: '#666',
    fontSize: 14,
  },
  value: {
    color: '#333',
    fontWeight: '600',
    fontSize: 14,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 10,
    minHeight: 100,
    textAlignVertical: 'top',
    fontSize: 14,
    color: '#333',
  },
  notesText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
});

export default TradeDetailScreen;
